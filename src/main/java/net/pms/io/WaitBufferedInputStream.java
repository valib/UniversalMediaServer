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
import java.util.Objects;

public class WaitBufferedInputStream extends InputStream {
	private final BufferedOutputFile outputStream;
	private volatile long readCount;
	private boolean firstRead;
	private volatile boolean closed;

	public void setReadCount(long readCount) {
		synchronized (outputStream) {
			this.readCount = readCount;
			outputStream.notifyAll();
		}
	}

	public long getReadCount() {
		return readCount;
	}

	WaitBufferedInputStream(BufferedOutputFile outputStream) {
		this.outputStream = outputStream;
		firstRead = true;
	}

	/** Waits for the normal startup buffer without consuming the first byte. */
	public long getLengthAtStart() throws IOException {
		if (closed) {
			return -1;
		}
		outputStream.read(true, readCount);
		return outputStream.getCompleteLength();
	}

	/** Reads the next byte without advancing this reader in the transcode buffer. */
	public int peek() throws IOException {
		ensureOpen();
		outputStream.awaitData(this);
		return outputStream.read(firstRead, getReadCount());
	}

	@Override
	public int read() throws IOException {
		int r = peek();
		if (r != -1) {
			setReadCount(getReadCount() + 1);
		}
		firstRead = false;
		return r;
	}

	@Override
	public int read(byte[] b, int off, int len) throws IOException {
		ensureOpen();
		Objects.checkFromIndexSize(off, len, b.length);
		if (len == 0) {
			return 0;
		}
		outputStream.awaitData(this);
		int returned = outputStream.read(firstRead, getReadCount(), b, off, len);
		if (returned != -1) {
			setReadCount(getReadCount() + returned);
		}
		firstRead = false;
		return returned;
	}

	@Override
	public int read(byte[] b) throws IOException {
		return read(b, 0, b.length);
	}

	@Override
	public int available() throws IOException {
		ensureOpen();
		long remaining = outputStream.getWriteCount() - readCount;
		return (int) Math.max(0, Math.min(Integer.MAX_VALUE, remaining));
	}

	@Override
	public void close() throws IOException {
		synchronized (outputStream) {
			if (!closed) {
				closed = true;
				outputStream.removeInputStream(this);
				outputStream.detachInputStream();
			}
		}
	}

	private void ensureOpen() throws IOException {
		if (closed) {
			throw new IOException("Stream closed");
		}
	}
}

