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
package net.pms.encoders;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import java.io.EOFException;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import net.pms.PMS;
import net.pms.configuration.UmsConfiguration;
import net.pms.io.BufferedOutputFileImpl;
import net.pms.io.OutputParams;
import net.pms.io.ProcessWrapper;
import net.pms.io.ProcessWrapperImpl;
import net.pms.media.MediaInfo;
import net.pms.renderers.Renderer;
import net.pms.store.StoreItem;
import net.pms.store.item.RealFile;
import net.pms.store.item.WebAudioStream;
import net.pms.util.ByteRange;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class TranscodeReconnectTest {
	private UmsConfiguration config;
	private Renderer renderer;
	private TestEncoder engine;

	@BeforeEach
	void setUp() throws Exception {
		System.setProperty(PMS.PROPERTY_RUNNING_TESTS, "true");
		config = new UmsConfiguration(false);
		PMS.setConfiguration(config);
		renderer = new Renderer((String) null) {
			@Override
			public UmsConfiguration getUmsConfiguration() {
				return config;
			}
		};
		engine = new TestEncoder();
	}

	private static class TestEncoder extends FFmpegAudio {
		private final List<ProcessWrapper> processes = new ArrayList<>();
		private BufferedOutputFileImpl output;
		private boolean failNextOpen;
		private boolean emptyNextOutput;

		@Override
		public ProcessWrapper launchTranscode(StoreItem resource, MediaInfo media, OutputParams params) throws IOException {
			params.setMaxBufferSize(1);
			params.setMinBufferSize(0);
			params.setSecondReadMinSize(0);
			params.setWaitBeforeStart(0);
			params.setHideBuffer(true);
			var buffer = new BufferedOutputFileImpl(params);
			if (emptyNextOutput) {
				buffer.close();
				emptyNextOutput = false;
			} else {
				buffer.write(new byte[]{(byte) (processes.size() + 1), 20, 30});
			}
			output = buffer;
			boolean failOpen = failNextOpen;
			failNextOpen = false;
			var process = new ProcessWrapperImpl(new String[]{"test-encoder"}, params) {
				@Override
				public InputStream getInputStream(long seek) throws IOException {
					if (failOpen) {
						throw new IOException("Replacement output unavailable");
					}
					return buffer.getInputStream(seek);
				}

				@Override
				public void stopProcess() {
					buffer.reset();
					super.stopProcess();
				}
			};
			processes.add(process);
			return process;
		}
	}

	private void configure(StoreItem item) {
		item.setMediaInfo(new MediaInfo());
		item.setTranscodingSettings(new TranscodingSettings(engine, EncodingFormat.AUDIO.get("MP3")));
	}

	@Test
	void reconnectDuringFinalCleanupStartsOneNewEncoder() throws Exception {
		var item = new WebAudioStream(renderer, "Radio", "https://radio.invalid/stream", null);
		configure(item);
		try (InputStream first = item.getInputStream(new ByteRange())) {
			engine.output.close();
			assertArrayEquals(new byte[]{1, 20, 30}, first.readAllBytes());
		}

		// Cleanup releases the buffer under its lock, then stops the process outside it.
		engine.output.reset();
		try (InputStream retry = item.getInputStream(new ByteRange())) {
			engine.output.close();
			assertArrayEquals(new byte[]{2, 20, 30}, retry.readAllBytes());
		}
		try (InputStream range = item.getInputStream(new ByteRange(1L, null))) {
			assertArrayEquals(new byte[]{20, 30}, range.readAllBytes());
		}
		assertEquals(2, engine.processes.size());
	}

	@Test
	void exclusiveFileReplayRetiresTheOriginalOnlyAfterReplacementOpens() throws Exception {
		verifyFileReplay(true);
	}

	@Test
	void sharedFileReplayKeepsTheOriginalReaders() throws Exception {
		verifyFileReplay(false);
	}

	private void verifyFileReplay(boolean exclusive) throws Exception {
		config.setTranscodeBlocksMultipleConnections(exclusive);
		config.setTrancodeKeepFirstConnections(false);
		var item = new RealFile(renderer, new File("audio.mp3"));
		configure(item);
		try (InputStream first = item.getInputStream(new ByteRange())) {
			assertArrayEquals(new byte[]{1, 20, 30}, first.readNBytes(3));
			byte[] tail = new byte[1024 * 1024];
			tail[0] = 40;
			tail[1] = 41;
			engine.output.write(tail);
			engine.output.close();

			engine.failNextOpen = true;
			assertThrows(IOException.class, () -> item.getInputStream(new ByteRange()));
			assertFalse(engine.processes.get(0).isDestroyed());
			assertTrue(engine.processes.get(1).isDestroyed());
			assertEquals(40, first.read());

			engine.emptyNextOutput = true;
			assertThrows(EOFException.class, () -> item.getInputStream(new ByteRange()));
			assertFalse(engine.processes.get(0).isDestroyed());
			assertTrue(engine.processes.get(2).isDestroyed());
			assertNull(engine.output.getCurrentInputStream());
			assertEquals(41, first.read());

			try (InputStream retained = item.getInputStream(new ByteRange(3L, null))) {
				assertEquals(40, retained.read());
				try (InputStream replay = item.getInputStream(new ByteRange())) {
					engine.output.close();
					assertArrayEquals(new byte[]{4, 20, 30}, replay.readAllBytes());
				}
				assertEquals(exclusive, engine.processes.get(0).isDestroyed());
				assertEquals(exclusive ? -1 : 41, retained.read());
			}
			assertEquals(4, engine.processes.size());
		}
	}
}
