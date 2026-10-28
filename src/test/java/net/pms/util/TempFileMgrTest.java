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
package net.pms.util;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.TimerTask;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class TempFileMgrTest {

	@TempDir
	Path directory;

	@Test
	void loadsLargeRegistryWithoutChangingIt() throws Exception {
		Path registry = directory.resolve("UMS.tmpmgr");
		StringBuilder original = new StringBuilder("# existing registry\n");
		for (int i = 0; i < 1000; i++) {
			original.append(directory.resolve("temporary-file-" + i))
				.append(",1209600000\n");
		}
		Files.writeString(registry, original, StandardCharsets.UTF_8);
		TempFileMgr manager = new TempFileMgr(registry.toFile());
		assertEquals(original.toString(), Files.readString(registry));

		manager.add(directory.resolve("extra").toFile());
		String persisted = Files.readString(registry);
		assertEquals(1001, persisted.lines().filter(line -> !line.startsWith("#")).count());
		for (int i = 0; i < 1000; i++) {
			assertTrue(persisted.contains(directory.resolve("temporary-file-" + i) + ",1209600000\n"));
		}
	}

	@Test
	void loadsCommaNamesAndLegacyOrInvalidTimeouts() throws Exception {
		Path registry = directory.resolve("UMS.tmpmgr");
		Path comma = directory.resolve("movie,part1");
		Path legacy = directory.resolve("legacy");
		Path invalid = directory.resolve("invalid");
		Files.writeString(registry, comma + ",12345\n" + legacy + "\n" + invalid + ",oops\n");
		TempFileMgr manager = new TempFileMgr(registry.toFile());
		manager.add(directory.resolve("extra").toFile());
		String persisted = Files.readString(registry);
		assertTrue(persisted.contains(comma + ",12345\n"));
		assertTrue(persisted.contains(legacy + ",1209600000\n"));
		assertTrue(persisted.contains(invalid + ",1209600000\n"));
	}

	@Test
	void serializesAddingWithAnInProgressScan() throws Exception {
		TempFileMgr manager = new TempFileMgr(directory.resolve("UMS.tmpmgr").toFile());
		CountDownLatch entered = new CountDownLatch(1);
		CountDownLatch release = new CountDownLatch(1);
		File blocking = new File(directory.resolve("blocking").toString()) {
			@Override
			public boolean exists() {
				entered.countDown();
				try {
					if (!release.await(5, TimeUnit.SECONDS)) {
						throw new IllegalStateException("Test scan timed out");
					}
				} catch (InterruptedException e) {
					Thread.currentThread().interrupt();
					throw new IllegalStateException(e);
				}
				return true;
			}

			@Override
			public long lastModified() {
				return System.currentTimeMillis();
			}
		};
		manager.add(blocking);
		ExecutorService executor = Executors.newFixedThreadPool(2);
		try {
			Future<?> scan = executor.submit(manager.createCleanupTask());
			assertTrue(entered.await(5, TimeUnit.SECONDS));
			CountDownLatch adding = new CountDownLatch(1);
			Future<?> add = executor.submit(() -> {
				adding.countDown();
				manager.add(directory.resolve("added").toFile());
			});
			assertTrue(adding.await(5, TimeUnit.SECONDS));
			assertThrows(TimeoutException.class, () -> add.get(100, TimeUnit.MILLISECONDS));
			release.countDown();
			scan.get(5, TimeUnit.SECONDS);
			add.get(5, TimeUnit.SECONDS);
			String persisted = Files.readString(directory.resolve("UMS.tmpmgr"));
			assertTrue(persisted.contains(blocking.getAbsolutePath()));
			assertTrue(persisted.contains(directory.resolve("added").toString()));
		} finally {
			release.countDown();
			executor.shutdownNow();
			assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS));
		}
	}

	@Test
	void cleanupTaskCanRunAgainAfterRuntimeFailure() throws Exception {
		Path registry = directory.resolve("UMS.tmpmgr");
		TempFileMgr manager = new TempFileMgr(registry.toFile());
		AtomicBoolean fail = new AtomicBoolean(true);
		File unstable = new File(directory.resolve("unstable").toString()) {
			@Override
			public boolean exists() {
				if (fail.getAndSet(false)) {
					throw new IllegalStateException("Simulated filesystem failure");
				}
				return false;
			}
		};
		manager.add(unstable);
		TimerTask task = manager.createCleanupTask();
		assertDoesNotThrow(task::run);
		assertTrue(Files.readString(registry).contains(unstable.getAbsolutePath()));
		assertDoesNotThrow(task::run);
		assertFalse(Files.readString(registry).contains(unstable.getAbsolutePath()));
	}

	@Test
	void deletesExpiredFilesAndKeepsRecentFiles() throws Exception {
		Path registry = directory.resolve("UMS.tmpmgr");
		Path expired = Files.createFile(directory.resolve("expired"));
		Path recent = Files.createFile(directory.resolve("recent"));
		assertTrue(expired.toFile().setLastModified(System.currentTimeMillis() - 10000));
		TempFileMgr manager = new TempFileMgr(registry.toFile());
		manager.add(expired.toFile(), 1000);
		manager.add(recent.toFile());
		manager.createCleanupTask().run();
		assertFalse(Files.exists(expired));
		assertTrue(Files.exists(recent));
		assertFalse(Files.readString(registry).contains(expired.toString()));
		assertTrue(Files.readString(registry).contains(recent.toString()));
	}
}
