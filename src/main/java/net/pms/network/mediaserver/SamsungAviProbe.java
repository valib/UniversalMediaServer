/*
 * This file is part of Universal Media Server, based on PS3 Media Server.
 *
 * This program is a free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the Free
 * Software Foundation; version 2 of the License only.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
 * details.
 *
 * You should have received a copy of the GNU General Public License along with
 * this program; if not, write to the Free Software Foundation, Inc., 51
 * Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
 */
package net.pms.network.mediaserver;

import com.google.common.cache.Cache;
import com.google.common.cache.CacheBuilder;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.function.DoubleConsumer;
import net.pms.network.StartStopListener;
import net.pms.renderers.Renderer;
import net.pms.store.StoreItem;
import net.pms.store.item.RealFile;
import net.pms.util.FileUtil;

/**
 * Native AVI probes captured from the GQ65QN90DATXZG in UMS issue 6444.
 * With an identical prefix in browsing and playback, keep the offset local while
 * reading 0 (metadata), 0, index, body, index + 8, and optionally body again.
 * The last read can become playback while the response is already in flight.
 */
public final class SamsungAviProbe {
	private record Key(Renderer renderer, int userId, String itemId) { }

	// All captured native AVI requests use this first data offset.
	private static final long BODY_OFFSET = 10252;

	private static final Cache<Key, SamsungAviProbe> ITEMS = CacheBuilder.newBuilder()
		.maximumSize(1024).expireAfterAccess(1, TimeUnit.MINUTES).build();

	/** A null result from inspect leaves the ordinary streaming path in charge. */
	public record Read(DoubleConsumer position, StartStopListener listener) { }
	private static final Read UNTRACKED = new Read(value -> { }, null);

	private enum Step { IDLE, INFO, ZERO, TAIL, BODY, TAIL_DATA, BODY_DATA, AFTER_BODY }
	private enum Selection { NONE, METADATA, CAPTION, CONFIRMED }

	private final Key key;
	private Step next = Step.IDLE;
	private Selection selection = Selection.NONE;
	private long firstMetadata;
	private long tailOffset;
	private long lastOffset = -1;
	private PendingStream pending;

	private SamsungAviProbe(Key key) {
		this.key = key;
	}

	private static SamsungAviProbe forItem(Renderer renderer, StoreItem item) {
		if (!(item instanceof RealFile file) || !renderer.isSamsung() || item.isTranscoded() || item.isResume() ||
				item.getMediaInfo() == null || !item.getMediaInfo().isVideo() ||
				!"avi".equalsIgnoreCase(FileUtil.getExtension(file.getFile())) || item.getId() == null) {
			return null;
		}
		Map<String, String> details = renderer.getDetails();
		if (details == null || !"GQ65QN90DATXZG".equals(details.get("modelName"))) {
			return null;
		}
		Key key = new Key(renderer, renderer.getAccountUserId(), item.getId());
		return ITEMS.asMap().computeIfAbsent(key, SamsungAviProbe::new);
	}

	public static void browsedMetadata(Renderer renderer, StoreItem item) {
		SamsungAviProbe probe = forItem(renderer, item);
		if (probe != null) {
			probe.metadata();
		}
	}

	private synchronized void metadata() {
		// Limit the lifetime of an unfinished control exchange, not the length of a play.
		if (selection == Selection.CAPTION && selectionIsFresh()) {
			selection = Selection.CONFIRMED;
			if (pending != null) {
				pending.authorized = true;
			}
		} else {
			firstMetadata = System.nanoTime();
			selection = Selection.METADATA;
		}
	}

	private boolean selectionIsFresh() {
		return System.nanoTime() - firstMetadata < TimeUnit.SECONDS.toNanos(5);
	}

	public static Read inspect(HttpServletRequest req, Renderer renderer, StoreItem item, long offset) {
		SamsungAviProbe probe = forItem(renderer, item);
		return probe == null ? null : probe.read(req, item, offset);
	}

	private synchronized Read read(HttpServletRequest req, StoreItem item, long offset) {
		String capabilities = req.getHeader("getcontentfeatures.dlna.org");
		boolean features = "1".equals(capabilities);
		String caption = req.getHeader("getCaptionInfo.sec");
		String info = req.getHeader("getmediainfo.sec");
		String range = req.getHeader("Range");
		boolean timeSeek = req.getHeader("TimeSeekRange.dlna.org") != null;
		boolean nativeClient = req.getHeader("User-Agent") == null && "close".equalsIgnoreCase(req.getHeader("Connection"));
		if ("HEAD".equalsIgnoreCase(req.getMethod())) {
			if (nativeClient && range == null && !timeSeek && "HTTP/1.1".equals(req.getProtocol()) && features && info == null && caption == null) {
				next = Step.INFO;
				lastOffset = -1;
				pending = null;
				// The next episode's caption HEAD can precede this HEAD.
				if (selection == Selection.CONFIRMED) {
					selection = Selection.NONE;
				}
			} else if (nativeClient && range == null && !timeSeek && capabilities == null && info == null &&
					"HTTP/1.0".equals(req.getProtocol()) && "1".equals(caption) && selection == Selection.METADATA && selectionIsFresh()) {
				selection = Selection.CAPTION;
			}
			return UNTRACKED;
		}

		// A late write on an older HTTP response must not rewind a newer seek.
		pending = null;
		boolean selected = selection == Selection.CONFIRMED && selectionIsFresh();
		if (!selected && nativeClient && features && caption == null && !timeSeek && "HTTP/1.1".equals(req.getProtocol()) &&
				"GET".equals(req.getMethod()) && ("bytes=" + offset + "-").equals(range)) {
			if ("1".equals(info) && offset == 0 && (next == Step.INFO || next == Step.ZERO)) {
				next = Step.ZERO;
				return UNTRACKED;
			}
			if (info == null && next != Step.IDLE && next != Step.INFO) {
				if ((next == Step.BODY_DATA || next == Step.AFTER_BODY) && offset == BODY_OFFSET) {
					// This read can become the foreground stream without a new GET.
					next = Step.AFTER_BODY;
					lastOffset = offset;
					pending = new PendingStream(req.getRemoteAddr(), item);
					return new Read(pending::rememberPosition, pending);
				} else if (consumeProbeOffset(offset)) {
					return UNTRACKED;
				}
			}
		}
		// A different range (including a manual byte/time seek) uses the normal path.
		next = Step.IDLE;
		selection = Selection.NONE;
		return null;
	}

	private boolean consumeProbeOffset(long offset) {
		if (lastOffset == offset) {
			return true; // a retry of the last probe
		}
		if (next == Step.ZERO && offset == 0) {
			next = Step.TAIL;
		} else if (next == Step.TAIL && offset > BODY_OFFSET) {
			tailOffset = offset;
			next = Step.BODY;
		} else if (next == Step.BODY && offset == BODY_OFFSET) {
			next = Step.TAIL_DATA;
		} else if (next == Step.TAIL_DATA && offset - tailOffset == 8) {
			next = Step.BODY_DATA;
		} else {
			return false;
		}
		lastOffset = offset;
		return true;
	}

	private final class PendingStream extends StartStopListener {
		private final StoreItem item;
		private double position;
		// Guarded by the enclosing probe's monitor.
		private boolean authorized;

		PendingStream(String address, StoreItem item) {
			super(address, item);
			this.item = item;
		}

		void rememberPosition(double value) {
			position = value;
		}

		@Override
		public synchronized void start() {
			synchronized (SamsungAviProbe.this) {
				if (pending == this && authorized && ITEMS.getIfPresent(key) == SamsungAviProbe.this) {
					pending = null;
					selection = Selection.NONE;
					item.setLastStartPosition(position);
					next = Step.IDLE;
					super.start();
				}
			}
		}

		@Override
		public synchronized void stop() {
			synchronized (SamsungAviProbe.this) {
				if (pending == this) {
					pending = null;
				}
			}
			super.stop();
		}
	}
}
