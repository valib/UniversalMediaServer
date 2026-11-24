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
package net.pms.io;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.channels.Channels;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import net.pms.PMS;
import net.pms.configuration.UmsConfiguration;
import net.pms.encoders.HlsHelper;
import net.pms.util.IPushOutput;
import org.apache.commons.configuration2.ex.ConfigurationException;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

public class BufferedOutputFileImplTest {

	private static final int PACK_HEADER_LENGTH = 14;
	private static final int PES_HEADER_LENGTH = 14;
	// One byte past the writer's high-water mark for a 1 MiB transcode buffer.
	private static final int PAUSED_PREFIX = 1024 * 1024 - 600000 + 1;

	@BeforeAll
	public static void setUpClass() throws ConfigurationException, InterruptedException {
		PMS.setConfiguration(new UmsConfiguration(false));
	}

	/**
	 * After a time seek the PTS of each packet is shifted by the seek time,
	 * so the SCR of each pack header has to be shifted by the same amount.
	 * The SCR values are picked so that the bytes holding SCR bits 27..20 and
	 * 12..5 are above 127.
	 */
	@Test
	public void testTimeSeekShiftsScrWithPts() throws IOException {
		double timeSeek = 48.6;
		long scr = (0x9AL << 20) | (0xC5L << 5) | 0x13;
		long videoPts = scr + 45000;
		long audioPts = scr + 44000;

		ByteArrayOutputStream stream = new ByteArrayOutputStream();
		stream.write(packHeader(scr));
		stream.write(pes(0xE0, videoPts));
		stream.write(packHeader(scr + 3600));
		stream.write(pes(0xBD, audioPts));
		byte[] input = stream.toByteArray();

		byte[] output = writeAndRead(input, timeSeek);

		long scrOffset = (long) (timeSeek * 90000);
		long ptsOffset = (int) (timeSeek * 90000);
		int secondPack = PACK_HEADER_LENGTH + PES_HEADER_LENGTH + 4;
		assertEquals(scr + scrOffset, readScr(output, 0));
		assertEquals(videoPts + ptsOffset, readPts(output, PACK_HEADER_LENGTH));
		assertEquals(scr + 3600 + scrOffset, readScr(output, secondPack));
		assertEquals(audioPts + ptsOffset, readPts(output, secondPack + PACK_HEADER_LENGTH));
	}

	@Test
	public void testNoTimeSeekKeepsTimestamps() throws IOException {
		long scr = (0x9AL << 20) | (0xC5L << 5) | 0x13;
		long videoPts = scr + 45000;

		ByteArrayOutputStream stream = new ByteArrayOutputStream();
		stream.write(packHeader(scr));
		stream.write(pes(0xE0, videoPts));
		byte[] input = stream.toByteArray();

		byte[] output = writeAndRead(input, 0);

		assertEquals(scr, readScr(output, 0));
		assertEquals(videoPts, readPts(output, PACK_HEADER_LENGTH));
	}

	@Test
	public void testLiveChannelReadsOnlyProducedBytes() throws IOException {
		OutputParams params = new OutputParams(PMS.getConfiguration());
		params.setMinBufferSize(0);
		params.setMaxBufferSize(1);
		params.setSecondReadMinSize(0);
		BufferedOutputFileImpl buffer = new BufferedOutputFileImpl(params);
		InputStream input = buffer.getInputStream(0);
		byte[] source = new byte[12084];
		Arrays.fill(source, 3, source.length, (byte) 0x47);
		buffer.write(source, 3, source.length - 3);
		assertEquals(source.length - 3, input.available());

		ByteBuffer response = ByteBuffer.allocate(65536);
		assertEquals(source.length - 3, Channels.newChannel(input).read(response));
		assertArrayEquals(Arrays.copyOfRange(source, 3, source.length), Arrays.copyOf(response.array(), response.position()));
		assertEquals(0, input.available());
		buffer.write(0xA5);
		buffer.close();
		assertEquals(0xA5, input.read());
		assertEquals(-1, input.read());
		assertEquals(0, input.read(new byte[0]));
	}

	@Test
	public void testReadAcrossCircularBufferEnd() throws IOException {
		OutputParams params = new OutputParams(PMS.getConfiguration());
		params.setMinBufferSize(0);
		params.setMaxBufferSize(1);
		BufferedOutputFileImpl buffer = new BufferedOutputFileImpl(params);
		int capacity = 1024 * 1024;
		buffer.write(new byte[capacity - 2]);
		InputStream tail = buffer.getInputStream(capacity - 2);
		byte[] expected = {1, 2, 3, 4, 5};
		buffer.write(expected);
		buffer.close();
		assertEquals(-1, buffer.getCompleteLength());
		assertArrayEquals(expected, tail.readAllBytes());
		assertEquals(0, tail.available());
	}

	@Test
	public void testBothReadersKeepTheirBytesWhenTheWriterWraps() throws Exception {
		int capacity = 1024 * 1024;
		byte[] media = new byte[capacity + 32768];
		new Random(104).nextBytes(media);
		OutputParams params = new OutputParams(PMS.getConfiguration());
		params.setMinBufferSize(0);
		params.setSecondReadMinSize(0);
		params.setMaxBufferSize(1);
		BufferedOutputFileImpl buffer = new BufferedOutputFileImpl(params);
		var executor = Executors.newSingleThreadExecutor();
		try (InputStream slow = buffer.getInputStream(0); InputStream fast = buffer.getInputStream(0)) {
			int prefix = capacity - 32768;
			buffer.write(media, 0, prefix);
			assertArrayEquals(Arrays.copyOf(media, prefix), fast.readNBytes(prefix));

			var tail = executor.submit(() -> {
				buffer.write(media, prefix, media.length - prefix - 1);
				buffer.write(media[media.length - 1]);
				buffer.close();
				return true;
			});
			// The fast client can consume up to the edge while the slow client still needs byte zero.
			assertArrayEquals(Arrays.copyOfRange(media, prefix, capacity), fast.readNBytes(capacity - prefix));
			assertEquals(capacity, buffer.getWriteCount());
			assertArrayEquals(media, slow.readNBytes(media.length));
			assertTrue(tail.get(5, TimeUnit.SECONDS));
			assertArrayEquals(Arrays.copyOfRange(media, capacity, media.length), fast.readAllBytes());
			int oldest = media.length - capacity;
			assertThrows(BufferedOutputFile.DiscardedPositionException.class, () -> buffer.getInputStream(oldest - 1));
			try (InputStream retained = buffer.getInputStream(oldest)) {
				assertEquals(media[oldest] & 0xff, retained.read());
			}
		} finally {
			buffer.reset();
			executor.shutdownNow();
		}
	}

	@Test
	public void testClosingPausedReaderReleasesSingleByteWriter() throws Exception {
		int capacity = 1024 * 1024;
		OutputParams params = new OutputParams(PMS.getConfiguration());
		params.setMaxBufferSize(1);
		params.setMinBufferSize(0);
		BufferedOutputFileImpl buffer = new BufferedOutputFileImpl(params);
		var executor = Executors.newSingleThreadExecutor();
		try (InputStream paused = buffer.getInputStream(0); InputStream tail = buffer.getInputStream(capacity)) {
			buffer.write(new byte[capacity]);
			var last = executor.submit(() -> {
				buffer.write(0x7f);
				buffer.close();
				return true;
			});
			assertThrows(TimeoutException.class, () -> last.get(200, TimeUnit.MILLISECONDS));
			paused.close();
			assertTrue(last.get(5, TimeUnit.SECONDS));
			assertEquals(0x7f, tail.read());
			assertEquals(-1, tail.read());
		} finally {
			buffer.reset();
			executor.shutdownNow();
		}
	}

	public static class FiniteEncoder {
		public static void main(String[] args) throws IOException {
			System.out.write(new byte[PAUSED_PREFIX]);
			System.out.flush();
			if (System.in.read() == 1) {
				System.out.write(0x5B);
				System.out.flush();
			}
		}
	}

	@Test
	public void testSlowReaderReceivesTailAfterEncoderExits() throws Exception {
		OutputParams params = new OutputParams(PMS.getConfiguration());
		params.setMinBufferSize(0);
		params.setMaxBufferSize(1);
		params.setSecondReadMinSize(0);
		CompletableFuture<OutputStream> encoderInput = new CompletableFuture<>();
		params.setStdIn(new IPushOutput() {
			@Override
			public void push(OutputStream out) {
				encoderInput.complete(out);
			}

			@Override
			public boolean isUnderlyingSeekSupported() {
				return false;
			}
		});

		String classes = Path.of(FiniteEncoder.class.getProtectionDomain().getCodeSource().getLocation().toURI()).toString();
		String java = Path.of(System.getProperty("java.home"), "bin", "java").toString();
		ProcessWrapperImpl process = new ProcessWrapperImpl(new String[]{java, "-cp", classes, FiniteEncoder.class.getName()}, params);
		process.runInNewThread();
		try (OutputStream control = encoderInput.get(15, TimeUnit.SECONDS);
				InputStream first = process.getInputStream(0)) {
			long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
			while (first.available() < PAUSED_PREFIX && System.nanoTime() < deadline) {
				Thread.sleep(10);
			}
			assertEquals(PAUSED_PREFIX, first.available());
			control.write(1);
			control.flush();
			process.join(15000);
			assertFalse(process.isAlive());

			try (WaitBufferedInputStream retry = (WaitBufferedInputStream) process.getInputStream(0)) {
				assertEquals(-1, retry.getLengthAtStart());
				first.close();
				assertFalse(process.isReadyToStop());
				byte[] expected = new byte[PAUSED_PREFIX + 1];
				expected[PAUSED_PREFIX] = 0x5B;
				assertArrayEquals(expected, retry.readAllBytes());
				assertEquals(expected.length, retry.getLengthAtStart());
			}
			assertTrue(process.isReadyToStop());
		} finally {
			process.stopProcess();
		}
	}

	@Test
	public void testHlsReadWaitsForFirstByteAndWakesAtEof() throws Exception {
		OutputParams params = new OutputParams(PMS.getConfiguration());
		params.setHlsConfiguration(HlsHelper.getByKey("COPY_AAC-LC_0"));
		params.setMaxBufferSize(1);
		params.setMinBufferSize(0);
		params.setSecondReadMinSize(0);
		BufferedOutputFileImpl buffer = new BufferedOutputFileImpl(params);
		var executor = Executors.newSingleThreadExecutor();
		try (InputStream input = buffer.getInputStream(0)) {
			assertEquals(0, input.read(new byte[0]));
			var started = new CountDownLatch(1);
			var first = executor.submit(() -> {
				started.countDown();
				return input.read();
			});
			assertTrue(started.await(5, TimeUnit.SECONDS));
			// A temporary stall beyond the old 7.5 second prebuffer limit is not EOF.
			assertThrows(TimeoutException.class, () -> first.get(8, TimeUnit.SECONDS));
			buffer.write(0x47);
			assertEquals(0x47, first.get(5, TimeUnit.SECONDS).intValue());
			var last = executor.submit(() -> input.read(new byte[188]));
			buffer.close();
			assertEquals(-1, last.get(5, TimeUnit.SECONDS).intValue());
		} finally {
			buffer.close();
			executor.shutdownNow();
		}
	}

	@Test
	public void testSingleConnectionPolicyHonorsTheSelectedReader() throws IOException {
		UmsConfiguration config = PMS.getConfiguration();
		boolean block = config.getTrancodeBlocksMultipleConnections();
		boolean keepFirst = config.getTrancodeKeepFirstConnections();
		try {
			config.setTranscodeBlocksMultipleConnections(true);
			config.setTrancodeKeepFirstConnections(true);
			OutputParams params = new OutputParams(config);
			params.setMaxBufferSize(1);
			BufferedOutputFileImpl buffer = new BufferedOutputFileImpl(params);
			int capacity = 1024 * 1024;
			buffer.write(new byte[capacity]);
			try (InputStream first = buffer.getInputStream(capacity)) {
				buffer.write(new byte[]{10, 20, 30});
				buffer.close();
				assertNull(buffer.getInputStream(capacity + 1));
				assertNull(buffer.getInputStream(0));

				config.setTrancodeKeepFirstConnections(false);
				assertThrows(BufferedOutputFile.DiscardedPositionException.class, () -> buffer.getInputStream(0));
				assertEquals(10, first.read());
				try (InputStream retry = buffer.getInputStream(capacity + 2)) {
					assertThrows(IOException.class, first::read);
					assertEquals(30, retry.read());
				}
			}
		} finally {
			config.setTranscodeBlocksMultipleConnections(block);
			config.setTrancodeKeepFirstConnections(keepFirst);
		}
	}

	private static byte[] writeAndRead(byte[] input, double timeSeek) throws IOException {
		OutputParams params = new OutputParams(PMS.getConfiguration());
		params.setMinBufferSize(0);
		params.setMaxBufferSize(1);
		params.setTimeSeek(timeSeek);
		BufferedOutputFileImpl buffer = new BufferedOutputFileImpl(params);
		buffer.write(input, 0, input.length);
		buffer.close();
		byte[] output = new byte[input.length];
		assertEquals(input.length, buffer.read(true, 0, output, 0, output.length));
		return output;
	}

	/**
	 * MPEG-2 pack header with the given SCR base (extension 0), no stuffing.
	 */
	private static byte[] packHeader(long scr) {
		return new byte[] {
			0, 0, 1, (byte) 0xBA,
			(byte) (0x44 | ((scr >> 27) & 0x38) | ((scr >> 28) & 0x03)),
			(byte) (scr >> 20),
			(byte) (((scr >> 12) & 0xF8) | 0x04 | ((scr >> 13) & 0x03)),
			(byte) (scr >> 5),
			(byte) (((scr << 3) & 0xF8) | 0x04),
			0x01,
			0x01, (byte) 0x89, (byte) 0xC3, // mux rate
			(byte) 0xF8 // no stuffing
		};
	}

	/**
	 * PES packet with a PTS and a 4-byte payload.
	 */
	private static byte[] pes(int streamId, long pts) {
		int payload = 4;
		int length = PES_HEADER_LENGTH - 6 + payload;
		return new byte[] {
			0, 0, 1, (byte) streamId,
			(byte) (length >> 8), (byte) length,
			(byte) 0x80, (byte) 0x80, 5,
			(byte) (0x21 | ((pts >> 29) & 0x0E)),
			(byte) (pts >> 22),
			(byte) (((pts >> 14) & 0xFE) | 1),
			(byte) (pts >> 7),
			(byte) (((pts << 1) & 0xFE) | 1),
			1, 2, 3, 4
		};
	}

	private static long readScr(byte[] b, int pos) {
		return (((b[pos + 4] >> 3) & 0x07L) << 30) |
			((b[pos + 4] & 0x03L) << 28) |
			((b[pos + 5] & 0xFFL) << 20) |
			(((b[pos + 6] >> 3) & 0x1FL) << 15) |
			((b[pos + 6] & 0x03L) << 13) |
			((b[pos + 7] & 0xFFL) << 5) |
			((b[pos + 8] >> 3) & 0x1FL);
	}

	private static long readPts(byte[] b, int pos) {
		return (((b[pos + 9] >> 1) & 0x07L) << 30) |
			((b[pos + 10] & 0xFFL) << 22) |
			(((b[pos + 11] >> 1) & 0x7FL) << 15) |
			((b[pos + 12] & 0xFFL) << 7) |
			((b[pos + 13] >> 1) & 0x7FL);
	}

}
