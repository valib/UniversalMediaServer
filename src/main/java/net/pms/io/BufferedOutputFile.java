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

import java.io.IOException;
import java.io.InputStream;

/**
 * Interface to easily subclass different implementations while keeping most of
 * the other UMS code the same. The original code has been moved to
 * {@link BufferedOutputFileImpl}.
 */
public interface BufferedOutputFile {
	/** The requested bytes have already been overwritten by the encoder. */
	class DiscardedPositionException extends IOException {
		private static final long serialVersionUID = 1L;

		public DiscardedPositionException(long position) {
			super("Transcode buffer no longer contains byte " + position);
		}
	}

	/** The encoder's output buffer has been released after playback stopped. */
	class ReleasedBufferException extends IOException {
		private static final long serialVersionUID = 1L;

		public ReleasedBufferException() {
			super("Transcode output buffer has been released");
		}
	}

	public abstract void close() throws IOException;

	public abstract WaitBufferedInputStream getCurrentInputStream();

	public abstract InputStream getInputStream(long newReadPosition) throws IOException;

	public abstract long getWriteCount();

	/** Waits for a stream with a live producer to have a readable byte or reach EOF. */
	default void awaitData(WaitBufferedInputStream input) throws IOException {
	}

	/** Returns the encoded length when the entire stream is still in the buffer. */
	default long getCompleteLength() {
		return -1;
	}

	public abstract void write(byte[] b, int off, int len) throws IOException;

	public abstract void write(int b) throws IOException;

	public abstract void attachThread(ProcessWrapper thread);

	public abstract void reset();

	public abstract int read(boolean firstRead, long readCount) throws IOException;

	public abstract int read(boolean firstRead, long readCount, byte[] b, int off, int len) throws IOException;

	public abstract void removeInputStream(WaitBufferedInputStream waitBufferedInputStream);

	public abstract void detachInputStream();

	public abstract void write(byte[] byteArray) throws IOException;
}
