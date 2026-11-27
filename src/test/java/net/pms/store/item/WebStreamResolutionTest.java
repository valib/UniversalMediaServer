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
package net.pms.store.item;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import com.sun.net.httpserver.HttpServer;
import java.io.File;
import java.lang.ref.Reference;
import java.lang.ref.WeakReference;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import net.pms.PMS;
import net.pms.configuration.RendererConfiguration;
import net.pms.configuration.UmsConfiguration;
import net.pms.database.MediaDatabase;
import net.pms.encoders.TranscodingSettings;
import net.pms.external.JavaHttpClient;
import net.pms.media.MediaInfo;
import net.pms.media.audio.metadata.MediaAudioMetadata;
import net.pms.renderers.Renderer;
import net.pms.store.MediaInfoStore;
import net.pms.store.container.FileTranscodeVirtualFolder;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

public class WebStreamResolutionTest {

	private static Renderer renderer;

	@BeforeAll
	static void configure() throws Exception {
		System.setProperty(PMS.PROPERTY_RUNNING_TESTS, "true");
		PMS.setConfiguration(new UmsConfiguration(false));
		renderer = new Renderer(new RendererConfiguration(new File("src/main/external-resources/renderers/VLC-for-desktop.conf")));
	}

	@Test
	void cachedStreamIsAvailableImmediatelyAndReplacesPrematureTranscoding() {
		String url = newUrl();
		MediaInfo parsed = parsedVideo();
		MediaInfoStore.storeMediaInfo(url, parsed);
		try {
			WebVideoStream stream = new WebVideoStream(renderer, "VLC stream", url, null);
			assertTrue(stream.isValid());
			stream.setTranscodingSettings(new TranscodingSettings(null, null));
			stream.resolveInBackground();
			assertSame(parsed, stream.getMediaInfo());
			assertTrue(stream.isTranscoded(), "The browse decision remains provisional until playback");

			stream.prepareForPlayback();
			assertFalse(stream.isTranscoded(), "VLC supports video/mpeg without transcoding");
		} finally {
			MediaInfoStore.removeMediaEntryFromCache(url);
		}
	}

	@Test
	void everyRendererCopyReceivesAnOngoingProbe() throws Exception {
		checkOngoingProbe(false, false);
	}

	@Test
	void timeoutLeavesSharedProbeAvailableToOtherResources() throws Exception {
		checkOngoingProbe(true, false);
	}

	@Test
	void interruptionPreservesInterruptAndLeavesSharedProbeRunning() throws Exception {
		checkOngoingProbe(false, true);
	}

	private void checkOngoingProbe(boolean timeOut, boolean interrupt) throws Exception {
		String url = newUrl();
		MediaInfo parsed = parsedVideo();
		Object lock = storeMethod("acquireLock", String.class).invoke(null, url);
		CountDownLatch resolved = new CountDownLatch(2);
		WebVideoStream first = observingStream(url, resolved);
		WebVideoStream second = observingStream(url, resolved);
		try {
			// Hold the real per-URL load lock so browsing returns while the probe is still pending.
			synchronized (lock) {
				first.resolveInBackground();
				second.resolveInBackground();
				assertNull(first.getMediaInfo());
				assertNull(second.getMediaInfo());
				if (timeOut) {
					assertFalse(second.awaitMediaInfo(10, TimeUnit.MILLISECONDS));
				} else if (interrupt) {
					Thread.currentThread().interrupt();
					try {
						assertFalse(second.awaitMediaInfo(1, TimeUnit.SECONDS));
						assertTrue(Thread.currentThread().isInterrupted());
					} finally {
						Thread.interrupted();
					}
				}
				// Supply the result before releasing the loader; no external stream is needed in this test.
				MediaInfoStore.storeMediaInfo(url, parsed);
			}
			assertTrue(resolved.await(3, TimeUnit.SECONDS), "Both renderer copies must receive the same probe result");
			assertSame(parsed, first.getMediaInfo());
			assertSame(parsed, second.getMediaInfo());
			assertTrue(second.awaitMediaInfo(1, TimeUnit.SECONDS));
		} finally {
			storeMethod("releaseLock", String.class, lock.getClass()).invoke(null, url, lock);
			MediaInfoStore.removeMediaEntryFromCache(url);
		}
	}

	@Test
	void explicitTranscodeFolderChoiceIsPreserved() {
		WebVideoStream stream = new WebVideoStream(renderer, "VLC stream", newUrl(), null);
		stream.setMediaInfo(parsedVideo());
		stream.setParent(new FileTranscodeVirtualFolder(renderer, stream));
		TranscodingSettings selected = new TranscodingSettings(null, null);
		stream.setTranscodingSettings(selected);
		stream.prepareForPlayback();
		assertSame(selected, stream.getTranscodingSettings());
	}

	@Test
	void cachedProbePreservesStationMetadata() {
		String url = newUrl();
		MediaInfoStore.storeMediaInfo(url, parsedVideo());
		try {
			WebVideoStream stream = new WebVideoStream(renderer, "Station", url, null);
			MediaInfo previous = new MediaInfo();
			MediaAudioMetadata metadata = new MediaAudioMetadata();
			metadata.setAlbum("Station album");
			metadata.setArtist("Station artist");
			previous.setAudioMetadata(metadata);
			stream.setMediaInfo(previous);
			stream.resolveInBackground();
			assertEquals("Station album", stream.getMediaInfo().getAudioMetadata().getAlbum());
			assertEquals("Station artist", stream.getMediaInfo().getAudioMetadata().getArtist());
		} finally {
			MediaInfoStore.removeMediaEntryFromCache(url);
		}
	}

	@Test
	void concurrentStationsMakeOneHttpHeaderRequestAndLeaveTheCacheClean() throws Exception {
		MediaDatabase.init();
		assertTrue(MediaDatabase.isAvailable(), "Cold URL lookup needs the test database");
		byte[] sample = Files.readAllBytes(Path.of("src/test/resources/net/pms/parsers/video-h264_frame_packing_2d.mp4"));
		CountDownLatch requestStarted = new CountDownLatch(1);
		CountDownLatch sendResponse = new CountDownLatch(1);
		AtomicInteger headerRequests = new AtomicInteger();
		HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
		String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/" + UUID.randomUUID() + ".mp4";
		server.createContext("/", exchange -> {
			try (exchange) {
				// FFmpeg may also read the file. Count only the UMS header request.
				if (JavaHttpClient.BROWSER_USER_AGENT.equals(exchange.getRequestHeaders().getFirst("User-Agent"))) {
					headerRequests.incrementAndGet();
					requestStarted.countDown();
					if (!sendResponse.await(10, TimeUnit.SECONDS)) {
						exchange.sendResponseHeaders(504, -1);
						return;
					}
				}
				exchange.getResponseHeaders().set("Content-Type", "video/mp4");
				exchange.sendResponseHeaders(200, sample.length);
				exchange.getResponseBody().write(sample);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
			}
		});
		server.start();
		try {
			CountDownLatch resolved = new CountDownLatch(2);
			WebVideoStream first = observingStream(url, resolved);
			WebVideoStream second = observingStream(url, resolved);
			first.setMediaInfo(stationInfo("A"));
			second.setMediaInfo(stationInfo("B"));
			first.resolveInBackground();
			assertTrue(requestStarted.await(10, TimeUnit.SECONDS), "First probe must reach the HTTP server");
			second.resolveInBackground();
			sendResponse.countDown();
			assertTrue(resolved.await(20, TimeUnit.SECONDS), "Both stations must receive the probe");

			WebVideoStream later = new WebVideoStream(renderer, "Later station", url, null);
			assertTrue(later.awaitMediaInfo(3, TimeUnit.SECONDS));
			MediaInfo cached = MediaInfoStore.getCachedWebStreamMediaInfo(url);
			assertNotNull(cached);
			assertAll(
				() -> assertEquals(1, headerRequests.get(), "HTTP header requests"),
				() -> assertEquals("video/mp4", cached.getMimeType()),
				() -> assertEquals("video/mp4", first.getMediaInfo().getMimeType()),
				() -> assertEquals("video/mp4", second.getMediaInfo().getMimeType()),
				() -> assertTags(first.getMediaInfo(), "Album A", "Artist A", "Genre A", "Title A"),
				() -> assertTags(second.getMediaInfo(), "Album B", "Artist B", "Genre B", "Title B"),
				() -> assertNull(cached.getAudioMetadata(), "cache"),
				() -> assertNull(later.getMediaInfo().getAudioMetadata(), "later station")
			);
		} finally {
			sendResponse.countDown();
			server.stop(0);
			MediaInfoStore.removeMediaEntry(url);
		}
	}

	@Test
	void liveStationKeepsItsProbeInTheWeakCache() {
		String url = newUrl();
		WebVideoStream station = new WebVideoStream(renderer, "Station", url, null);
		station.setMediaInfo(stationInfo("A"));
		MediaInfo parsed = parsedVideo();
		MediaInfoStore.storeMediaInfo(url, parsed);
		try {
			assertTrue(station.awaitMediaInfo(1, TimeUnit.SECONDS));
			Reference.reachabilityFence(parsed);
			parsed = null;
			WeakReference<Object> control = new WeakReference<>(new Object());
			System.gc();
			assumeTrue(control.refersTo(null), "The JVM did not collect the control object");
			assertNotNull(MediaInfoStore.getCachedWebStreamMediaInfo(url));
			Reference.reachabilityFence(station);
		} finally {
			MediaInfoStore.removeMediaEntryFromCache(url);
		}
	}

	@Test
	void stationTagsStayLocalWhenSharedProbeHasNoAudioMetadata() throws Exception {
		checkStationIsolation(null);
	}

	@Test
	void stationTagsFillOnlyBlanksInSharedProbeMetadata() throws Exception {
		MediaAudioMetadata probeTags = new MediaAudioMetadata();
		probeTags.setArtist("Probe artist");
		probeTags.setGenre(" ");
		probeTags.setSongname("Probe title");
		checkStationIsolation(probeTags);
	}

	private void checkStationIsolation(MediaAudioMetadata probeTags) throws Exception {
		String url = newUrl();
		MediaInfo parsed = parsedVideo();
		parsed.setAudioMetadata(probeTags);
		CountDownLatch resolved = new CountDownLatch(2);
		WebVideoStream first = observingStream(url, resolved);
		WebVideoStream second = observingStream(url, resolved);
		first.setMediaInfo(stationInfo("A"));
		second.setMediaInfo(stationInfo("B"));
		Object lock = storeMethod("acquireLock", String.class).invoke(null, url);
		try {
			synchronized (lock) {
				first.resolveInBackground();
				second.resolveInBackground();
				// Both items have subscribed before the loader can obtain its result.
				MediaInfoStore.storeMediaInfo(url, parsed);
			}
			assertTrue(resolved.await(3, TimeUnit.SECONDS), "Both stations must receive the probe");

			WebVideoStream fromCache = new WebVideoStream(renderer, "Later station", url, null);
			fromCache.setMediaInfo(stationInfo("C"));
			fromCache.resolveInBackground();
			MediaInfo cached = MediaInfoStore.getCachedWebStreamMediaInfo(url);
			assertSame(parsed, cached);
			assertAll(
				() -> assertStation(first, "A", probeTags != null),
				() -> assertStation(second, "B", probeTags != null),
				() -> assertStation(fromCache, "C", probeTags != null),
				() -> {
					if (probeTags == null) {
						assertNull(cached.getAudioMetadata());
					} else {
						assertTags(cached, null, "Probe artist", " ", "Probe title");
					}
				}
			);
		} finally {
			storeMethod("releaseLock", String.class, lock.getClass()).invoke(null, url, lock);
			MediaInfoStore.removeMediaEntryFromCache(url);
		}
	}

	private static MediaInfo stationInfo(String station) {
		MediaAudioMetadata tags = new MediaAudioMetadata();
		tags.setAlbum("Album " + station);
		tags.setArtist("Artist " + station);
		tags.setGenre("Genre " + station);
		tags.setSongname("Title " + station);
		MediaInfo media = new MediaInfo();
		media.setAudioMetadata(tags);
		return media;
	}

	private static void assertStation(WebStream stream, String station, boolean hasProbeTags) {
		MediaInfo media = stream.getMediaInfo();
		assertTrue(media.isMediaParsed());
		assertEquals("mpegts", media.getContainer());
		assertEquals("video/mpeg", media.getMimeType());
		assertTags(media, "Album " + station, hasProbeTags ? "Probe artist" : "Artist " + station,
			"Genre " + station, hasProbeTags ? "Probe title" : "Title " + station);
	}

	private static void assertTags(MediaInfo media, String album, String artist, String genre, String title) {
		MediaAudioMetadata tags = media.getAudioMetadata();
		assertNotNull(tags);
		assertAll(
			() -> assertEquals(album, tags.getAlbum(), "album"),
			() -> assertEquals(artist, tags.getArtist(), "artist"),
			() -> assertEquals(genre, tags.getGenre(), "genre"),
			() -> assertEquals(title, tags.getSongname(), "title")
		);
	}

	private static WebVideoStream observingStream(String url, CountDownLatch resolved) {
		return new WebVideoStream(renderer, "VLC stream", url, null) {
			@Override
			public void setMediaInfo(MediaInfo media) {
				super.setMediaInfo(media);
				if (media != null && media.isMediaParsed()) {
					resolved.countDown();
				}
			}
		};
	}

	private static String newUrl() {
		return "http://127.0.0.1/stream-" + UUID.randomUUID() + ".m2t";
	}

	private static MediaInfo parsedVideo() {
		MediaInfo media = new MediaInfo();
		media.setContainer("mpegts");
		media.setMimeType("video/mpeg");
		media.setMediaParser("WEBSTREAM");
		return media;
	}

	private static Method storeMethod(String name, Class<?>... types) throws Exception {
		Method method = MediaInfoStore.class.getDeclaredMethod(name, types);
		method.setAccessible(true);
		return method;
	}
}
