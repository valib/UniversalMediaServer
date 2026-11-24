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
import java.io.IOException;
import java.io.InputStream;
import net.pms.PMS;
import net.pms.configuration.UmsConfiguration;
import net.pms.io.BufferedOutputFileImpl;
import net.pms.io.OutputParams;
import net.pms.io.ProcessWrapper;
import net.pms.io.ProcessWrapperImpl;
import net.pms.media.MediaInfo;
import net.pms.renderers.Renderer;
import net.pms.store.StoreItem;
import net.pms.store.item.WebAudioStream;
import net.pms.util.ByteRange;
import org.junit.jupiter.api.Test;

class TranscodeReconnectTest {
	@Test
	void reconnectDuringFinalCleanupStartsOneNewEncoder() throws Exception {
		System.setProperty(PMS.PROPERTY_RUNNING_TESTS, "true");
		var config = new UmsConfiguration(false);
		PMS.setConfiguration(config);
		var renderer = new Renderer((String) null) {
			@Override
			public UmsConfiguration getUmsConfiguration() {
				return config;
			}
		};
		var item = new WebAudioStream(renderer, "Radio", "https://radio.invalid/stream", null);
		item.setMediaInfo(new MediaInfo());

		class TestEncoder extends FFmpegAudio {
			private int launches;
			private BufferedOutputFileImpl output;

			@Override
			public ProcessWrapper launchTranscode(StoreItem resource, MediaInfo media, OutputParams params) throws IOException {
				launches++;
				params.setMaxBufferSize(1);
				params.setMinBufferSize(0);
				params.setWaitBeforeStart(0);
				params.setHideBuffer(true);
				var buffer = new BufferedOutputFileImpl(params);
				buffer.write(new byte[]{(byte) launches, 20, 30});
				buffer.close();
				output = buffer;
				return new ProcessWrapperImpl(new String[]{"test-encoder"}, params) {
					@Override
					public InputStream getInputStream(long seek) throws IOException {
						return buffer.getInputStream(seek);
					}
				};
			}
		}
		var engine = new TestEncoder();
		item.setTranscodingSettings(new TranscodingSettings(engine, EncodingFormat.AUDIO.get("MP3")));
		try (InputStream first = item.getInputStream(new ByteRange())) {
			assertArrayEquals(new byte[]{1, 20, 30}, first.readAllBytes());
		}

		// Cleanup releases the buffer under its lock, then stops the process outside it.
		engine.output.reset();
		try (InputStream retry = item.getInputStream(new ByteRange())) {
			assertArrayEquals(new byte[]{2, 20, 30}, retry.readAllBytes());
		}
		try (InputStream range = item.getInputStream(new ByteRange(1L, null))) {
			assertArrayEquals(new byte[]{20, 30}, range.readAllBytes());
		}
		assertEquals(2, engine.launches);
	}
}
