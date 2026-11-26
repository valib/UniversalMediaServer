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
package net.pms.network.mediaserver.servlets;

import jakarta.servlet.AsyncContext;
import jakarta.servlet.AsyncEvent;
import jakarta.servlet.AsyncListener;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.WriteListener;
import jakarta.servlet.http.HttpServletMapping;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.net.InetAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Timer;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import net.pms.PMS;
import net.pms.configuration.UmsConfiguration;
import net.pms.configuration.sharedcontent.SharedContentConfiguration;
import net.pms.database.MediaDatabase;
import net.pms.dlna.DidlHelper;
import net.pms.formats.MPG;
import net.pms.media.MediaInfo;
import net.pms.media.MediaType;
import net.pms.network.mediaserver.MediaServer;
import net.pms.network.mediaserver.jupnp.support.contentdirectory.UmsContentDirectoryService;
import net.pms.renderers.ConnectedRenderers;
import net.pms.renderers.Renderer;
import net.pms.service.Services;
import net.pms.service.sleep.SleepManager;
import net.pms.store.MediaStatusStore;
import net.pms.store.MediaStore;
import net.pms.store.MediaStoreIds;
import net.pms.store.container.MediaMonitor;
import net.pms.store.item.RealFile;
import net.pms.util.FullyPlayedAction;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.jupnp.model.message.UpnpHeaders;
import org.jupnp.model.profile.RemoteClientInfo;
import org.jupnp.model.types.UnsignedIntegerFourBytes;
import org.mockito.ArgumentCaptor;
import org.mockito.MockedStatic;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class SamsungThumbnailRegressionTest {
	private static final String ADDRESS = "192.0.2.1";
	private static final String FEATURES = "getcontentFeatures.dlna.org";
	private static final String INFO = "getMediaInfo.sec";
	private static final String CAPTION = "getCaptionInfo.sec";
	private static final String SOAP_AGENT = "DLNADOC/1.50 SEC_HHP_SamsungDLNA/1.0 UPnP/1.0";
	private static final long FIRST_BLOCK = 65536;
	private static final double SAVED = 137.5; // an earlier, unrelated play position
	private static UmsConfiguration config;
	private static UmsConfiguration previousConfig;
	private static String previousTestFlag;

	@TempDir Path directory;
	private final String uuid = UUID.randomUUID().toString();
	private final Renderer renderer = mock(Renderer.class);
	private final MediaStore store = mock(MediaStore.class);
	private MockedStatic<ConnectedRenderers> devices;
	private MockedStatic<Services> services;
	private MockedStatic<MediaServer> server;
	private RealFile item;
	private long size;
	private String soapId;
	private MediaServerServlet servlet;
	private UmsContentDirectoryService directoryService;
	private MockedStatic<MediaStoreIds> ids;
	private RemoteClientInfo controlPoint;
	private TransferEvent duringNextTransfer;

	@BeforeAll
	static void configure() throws Exception {
		previousTestFlag = System.setProperty(PMS.PROPERTY_RUNNING_TESTS, "true");
		previousConfig = PMS.getConfiguration();
		if (previousConfig == null) {
			PMS.setConfiguration(new UmsConfiguration(false));
		}
		config = TestMonitor.configuration();
	}

	@AfterAll
	static void restoreConfiguration() {
		PMS.setConfiguration(previousConfig);
		if (previousTestFlag == null) {
			System.clearProperty(PMS.PROPERTY_RUNNING_TESTS);
		} else {
			System.setProperty(PMS.PROPERTY_RUNNING_TESTS, previousTestFlag);
		}
	}

	private static class TestMonitor extends MediaMonitor {
		TestMonitor(Renderer renderer, File directory) {
			super(renderer, new File[] {directory});
		}

		static UmsConfiguration configuration() {
			return CONFIGURATION;
		}
	}

	@BeforeEach
	void connect() throws Exception {
		devices = mockStatic(ConnectedRenderers.class);
		devices.when(() -> ConnectedRenderers.getUuidRenderer(uuid)).thenReturn(renderer);
		services = mockStatic(Services.class);
		SleepManager sleep = mock(SleepManager.class);
		services.when(Services::sleepManager).thenReturn(sleep);
		server = mockStatic(MediaServer.class);
		server.when(MediaServer::getServerName).thenReturn("UMS");
		when(renderer.isSamsung()).thenReturn(true);
		when(renderer.getDetails()).thenReturn(Map.of("modelName", "GQ65QN90DATXZG"));
		when(renderer.getConfName()).thenReturn("Samsung UHD TV 2019+");
		when(renderer.getUUID()).thenReturn(uuid);
		when(renderer.getMediaStore()).thenReturn(store);
		when(renderer.isAllowed()).thenReturn(true);
		when(renderer.getUmsConfiguration()).thenReturn(config);
		servlet = new MediaServerServlet();
		ids = mockStatic(MediaStoreIds.class);
		ids.when(MediaStoreIds::getSystemUpdateId).thenReturn(new UnsignedIntegerFourBytes(1));
		// Suppress the service's periodic SystemUpdateID task for this in-process test.
		try (var timers = mockConstruction(Timer.class)) {
			directoryService = new UmsContentDirectoryService();
		}
		var address = InetAddress.getByName(ADDRESS);
		var soapHeaders = new UpnpHeaders();
		soapHeaders.add("User-Agent", SOAP_AGENT);
		controlPoint = mock(RemoteClientInfo.class);
		when(controlPoint.getRequestHeaders()).thenReturn(soapHeaders);
		when(controlPoint.getRemoteAddress()).thenReturn(address);
		when(controlPoint.getRequestUserAgent()).thenReturn(SOAP_AGENT);
		devices.when(() -> ConnectedRenderers.getRenderer(eq(address), eq(SOAP_AGENT), anyCollection())).thenReturn(renderer);
	}

	@AfterEach
	void disconnect() {
		ids.close();
		server.close();
		services.close();
		devices.close();
	}

	private void video(int objectId, long fileSize, int bitrate, double duration) throws Exception {
		size = fileSize;
		String id = Integer.toString(objectId);
		soapId = id + (objectId == 288 ? "#665" : "#667");
		var file = directory.resolve("sample-" + id + ".avi").toFile();
		try (var out = new RandomAccessFile(file, "rw")) {
			out.setLength(size);
		}
		item = spy(new RealFile(renderer, file));
		var media = mock(MediaInfo.class);
		when(media.getMediaType()).thenReturn(MediaType.VIDEO);
		when(media.isVideo()).thenReturn(true);
		when(media.getDurationString()).thenReturn(net.pms.util.StringUtil.formatDLNADuration(duration));
		when(media.getBitRate()).thenReturn(bitrate);
		when(media.getDurationInSeconds()).thenReturn(duration);
		item.setMediaInfo(media);
		item.setFormat(new MPG());
		item.setId(id);
		item.setLastStartPosition(SAVED);
		doReturn("video/avi").when(item).getMimeType();
		doReturn(true).when(item).isCodeValid(item);
		doReturn("sample.avi").when(item).getDisplayName();
		// Observe the real listener's callbacks without starting DB or filesystem actions.
		doNothing().when(item).startPlaying(anyString());
		doNothing().when(item).stopPlaying(anyString());
		when(store.getResource(id)).thenReturn(item);
		when(store.getResource(soapId)).thenReturn(item);
		when(store.getResources(soapId, false)).thenReturn(List.of(item));
		doReturn(true).when(item).isCompatible();
	}

	@Test
	void browsingDoesNotStartOrStopPlaybackOrOverwritePosition() throws Exception {
		// #7365, 22:49:22.306, Vera 08-01, one of the eight wrongful moves.
		video(477, 483203228, 729495, 5299.04);
		probe(478963400);
		assertAll(
			() -> verify(item, never()).startPlaying(anyString()),
			() -> verify(item, never()).stopPlaying(anyString()),
			() -> assertEquals(SAVED, item.getLastStartPosition())
		);
	}

	// #7365, one case for each file the server actually moved while browsing.
	private record BrowseCase(int objectId, long size, int bitrate, double seconds, long index, long bytes, int bursts) { }

	@Test
	void allEightWrongfulMovesProduceNoPlaybackEvents() throws Exception {
		var cases = List.of(
			new BrowseCase(477, 483203228, 729495, 5299.04, 478963400, 4239820, 1),
			new BrowseCase(465, 610741896, 922035, 5299.08, 606502766, 3145728, 1),
			new BrowseCase(458, 499008562, 768492, 5194.68, 494852142, 4156412, 1),
			new BrowseCase(451, 449440744, 678939, 5295.80, 445204238, 4236498, 2),
			new BrowseCase(441, 439982706, 655746, 5367.72, 435687714, 1638400, 1),
			new BrowseCase(442, 502440744, 749090, 5365.88, 498147202, 3473408, 1),
			new BrowseCase(446, 458333012, 689363, 5318.92, 454077032, 2949120, 1),
			new BrowseCase(284, 238733610, 711639, 2683.76, 236586736, 393216, 1)
		);
		for (var episode : cases) {
			video(episode.objectId(), episode.size(), episode.bitrate(), episode.seconds());
			for (int i = 0; i < episode.bursts(); i++) {
				probe(episode.index(), FIRST_BLOCK, episode.bytes());
			}
			verify(item, never()).startPlaying(anyString());
			verify(item, never()).stopPlaying(anyString());
			assertEquals(SAVED, item.getLastStartPosition(), "Object " + episode.objectId());
		}
	}

	@Test
	void seekBackToTheIndexAfterABodyReadUsesNormalPlayback() throws Exception {
		// Compatibility check, manually seeking is absent from the captures.
		video(287, 597752380, 861215, 5552.64);
		probe(593310402);
		get(10252, 1703936).run();
		get(593310410, 1048576).run();
		verify(item).startPlaying(ADDRESS);
		assertEquals(593310410L * 8 / 861215.0, item.getLastStartPosition(), 0.01);
	}

	@Test
	void explicitSelectionDuringTheProbeAllowsASubsequentByteSeek() throws Exception {
		video(287, 597752380, 861215, 5552.64);
		head(FEATURES, "HTTP/1.1");
		request("GET", "HTTP/1.1", 0L, Map.of(FEATURES, "1", INFO, "1"), FIRST_BLOCK).run();
		get(0, FIRST_BLOCK).run();
		selectFilm();
		get(510000000, 1048576).run();
		verify(item).startPlaying(ADDRESS);
		assertEquals(510000000L * 8 / 861215.0, item.getLastStartPosition(), 0.01);
	}

	@Test
	void sameMovieBrowsedInOctoberIsStillOnlyAPreviewAfterReturningToItsStart() throws Exception {
		// #7361, 15:45:52.893. The last GET also exceeds the existing byte threshold.
		video(287, 597752380, 861215, 5552.64);
		probe(593310402);
		get(10252, 1703936).run();
		assertAll(
			() -> verify(item, never()).startPlaying(anyString()),
			() -> verify(item, never()).stopPlaying(anyString()),
			() -> assertEquals(SAVED, item.getLastStartPosition())
		);
	}

	@Test
	void realPlaybackStartsAfterSharedPrefixAndHonoursFinal34ByteRange() throws Exception {
		// #7365, 22:50:07.741 through 00:22:27.140, Mary Higgins Clark 01-07.
		video(287, 597752380, 861215, 5552.64);
		playFilm();
		assertEquals(597752346L * 8 / 861215.0, item.getLastStartPosition(), 0.01);
	}

	@Test
	void captionQueryAloneCannotStartPlaybackOrResetPosition() throws Exception {
		// #7365, 00:22:31.811: this HEAD also occurs BEFORE the next item's probes.
		video(288, 521764600, 751752, 5552.52);
		head(CAPTION, "HTTP/1.0");
		assertAll(
			() -> verify(item, never()).startPlaying(anyString()),
			() -> verify(item, never()).stopPlaying(anyString()),
			() -> assertEquals(SAVED, item.getLastStartPosition())
		);
	}

	@Test
	void normalByteSeekAfterPlaybackKeepsItsResponseAndCallbacks() throws Exception {
		// Synthetic manual seek, deliberately using the same headers as the preview.
		video(287, 597752380, 861215, 5552.64);
		probe(593310402);
		selectFilm();
		get(817728, 593559552).run();
		clearInvocations(item);
		get(510000000, 1048576).run();
		verify(item, atLeastOnce()).startPlaying(ADDRESS);
		verify(item, atLeastOnce()).stopPlaying(ADDRESS);
		assertEquals(510000000L * 8 / 861215.0, item.getLastStartPosition(), 0.01);
		clearInvocations(item);
		get(10000000, 1048576).run();
		verify(item).startPlaying(ADDRESS);
		verify(item).stopPlaying(ADDRESS);
		assertEquals(10000000L * 8 / 861215.0, item.getLastStartPosition(), 0.01);
	}

	@Test
	void explicitTimeSeekKeepsItsTimeRangeAndPlaybackCallbacks() throws Exception {
		// Synthetic DLNA control; neither TRACE contains a manually identified seek.
		video(287, 597752380, 861215, 5552.64);
		selectFilm();
		get(817728, 593559552).run();
		clearInvocations(item);
		request("GET", "HTTP/1.1", null, Map.of(FEATURES, "1", "TimeSeekRange.dlna.org", "npt=1800-"), 1048576).run();
		verify(item, atLeastOnce()).startPlaying(ADDRESS);
		verify(item, atLeastOnce()).stopPlaying(ADDRESS);
		assertEquals(1800, item.getLastStartPosition(), 0.01);
	}

	@Test
	void browsingCannotMarkOrMoveTheFile() throws Exception {
		checkMoveAction(false);
	}

	@Test
	void fullPlaybackMarksAndMovesTheFileOnce() throws Exception {
		checkMoveAction(true);
	}

	private void checkMoveAction(boolean played) throws Exception {
		if (played) {
			video(287, 597752380, 861215, 5552.64);
		} else {
			video(477, 483203228, 729495, 5299.04);
		}
		item.setParent(store);
		var source = item.getFile().toPath();
		var target = Files.createDirectory(directory.resolve("played")).resolve(source.getFileName());
		var action = config.getFullyPlayedAction();
		String destination = config.getFullyPlayedOutputDirectory();
		try (
			var shares = mockStatic(SharedContentConfiguration.class);
			var db = mockStatic(MediaDatabase.class);
			var status = mockStatic(MediaStatusStore.class)
		) {
			shares.when(SharedContentConfiguration::getMonitoredFolders).thenReturn(List.of(directory.toFile()));
			config.setFullyPlayedAction(FullyPlayedAction.MOVE_FOLDER);
			config.setFullyPlayedOutputDirectory(target.getParent().toString());
			var monitor = new TestMonitor(renderer, directory.toFile());
			monitor.setId("42");
			var pendingStop = new AtomicBoolean();
			doAnswer(call -> {
				pendingStop.set(true);
				return null;
			}).when(item).stopPlaying(ADDRESS);
			if (played) {
				playFilm();
			} else {
				probe(478963400);
			}
			// Settle outstanding stop callbacks as a group after the captured burst.
			// The production deferrer uses a wall-clock delay and a per-item refcount.
			if (pendingStop.get()) {
				monitor.stopped(item);
			}
			if (played) {
				status.verify(() -> MediaStatusStore.setFullyPlayed(eq(source.toString()), eq(0), eq(true), anyDouble()));
				assertFalse(Files.exists(source));
				assertEquals(size, Files.size(target));
			} else {
				assertAll(
					() -> assertTrue(Files.exists(source)),
					() -> assertFalse(Files.exists(target)),
					status::verifyNoInteractions
				);
			}
		} finally {
			config.setFullyPlayedOutputDirectory(destination);
			config.setFullyPlayedAction(action);
		}
	}

	@Test
	void selectionOfOneItemCannotAuthorizeProbesForAnother() throws Exception {
		// Synthetic interleaving of two recorded sequences on the same renderer.
		video(287, 597752380, 861215, 5552.64);
		selectFilm();
		video(477, 483203228, 729495, 5299.04);
		probe(478963400);
		assertAll(
			() -> verify(item, never()).startPlaying(anyString()),
			() -> verify(item, never()).stopPlaying(anyString()),
			() -> assertEquals(SAVED, item.getLastStartPosition())
		);
	}

	@Test
	void nextEpisodesAlreadyOpenGetBecomesPlaybackOnlyAfterTheSecondMetadataBrowse() throws Exception {
		// #7365, item 288. Caption HEAD precedes the entire media probe.
		video(288, 521764600, 751752, 5552.52);
		browseItem();
		head(CAPTION, "HTTP/1.0");
		probe(517322674, 131072);
		duringNextTransfer = () -> {
			verify(item, never()).startPlaying(anyString());
			assertEquals(SAVED, item.getLastStartPosition());
			browseItem();
		};
		get(10252, 3211264).run();
		verify(item).startPlaying(ADDRESS);
		verify(item).stopPlaying(ADDRESS);
		double playPosition = 10252L * 8 / 751752.0;
		assertEquals(playPosition, item.getLastStartPosition(), 0.0001);
		// Same item a second later, now only browsing again, with no new selection.
		clearInvocations(item);
		probe(517322674);
		get(10252, 3145728).run();
		verify(item, never()).startPlaying(anyString());
		assertEquals(playPosition, item.getLastStartPosition(), 0.0001);
	}

	@Test
	void lateDataFromPreviouslySelectedGetCannotUndoANewerSeek() throws Exception {
		video(287, 597752380, 861215, 5552.64);
		probe(593310402);
		Runnable older = get(10252, 1703936);
		selectFilm();
		get(510000000, 1048576).run();
		clearInvocations(item);
		older.run();
		verify(item, never()).startPlaying(anyString());
		verify(item, never()).stopPlaying(anyString());
		assertEquals(510000000L * 8 / 861215.0, item.getLastStartPosition(), 0.01);
	}

	@Test
	void previewOfTheSameFileCannotOverwriteAnActivePlayPosition() throws Exception {
		video(287, 597752380, 861215, 5552.64);
		selectFilm();
		duringNextTransfer = () -> {
			verify(item).startPlaying(ADDRESS);
			probe(593310402);
			get(10252, 1703936).run();
			assertEquals(817728L * 8 / 861215.0, item.getLastStartPosition(), 0.0001);
		};
		get(817728, 1048576).run();
		verify(item).startPlaying(ADDRESS);
		verify(item).stopPlaying(ADDRESS);
	}

	@Test
	void mediaInfoHeaderWithoutTheObservedPreambleKeepsOrdinaryPlayback() throws Exception {
		video(287, 597752380, 861215, 5552.64);
		request("GET", "HTTP/1.1", 0L, Map.of(FEATURES, "1", INFO, "1"), 1048576).run();
		verify(item).startPlaying(ADDRESS);
		verify(item).stopPlaying(ADDRESS);
	}

	@Test
	void captionWithoutItemMetadataCannotPromoteAnOpenProbe() throws Exception {
		video(287, 597752380, 861215, 5552.64);
		probe(593310402);
		Runnable pending = get(10252, 1703936);
		head(CAPTION, "HTTP/1.0");
		pending.run();
		verify(item, never()).startPlaying(anyString());
		assertEquals(SAVED, item.getLastStartPosition());
	}

	@Test
	void otherSamsungModelsKeepTheirCurrentRangePlayback() throws Exception {
		// Scope control; synthetic metadata for an uncharacterised renderer.
		video(287, 597752380, 861215, 5552.64);
		when(renderer.getDetails()).thenReturn(Map.of("modelName", "other"));
		probe(593310402);
		verify(item, atLeastOnce()).startPlaying(ADDRESS);
		verify(item, atLeastOnce()).stopPlaying(ADDRESS);
	}

	@Test
	void lgLavfPreviewAndNormalLgPlaybackKeepTheirExistingBehaviour() throws Exception {
		// Compatibility control from PR #3731, not a Samsung capture.
		video(287, 597752380, 861215, 5552.64);
		when(renderer.isSamsung()).thenReturn(false);
		when(renderer.isLG()).thenReturn(true);
		when(renderer.getDetails()).thenReturn(Map.of());
		when(renderer.getConfName()).thenReturn("LG TV");
		request("GET", "HTTP/1.1", 10252L, Map.of("User-Agent", "Lavf/59.27.100"), 1048576).run();
		verify(item, never()).startPlaying(anyString());
		verify(item, never()).stopPlaying(anyString());
		request("GET", "HTTP/1.1", 10252L, Map.of("User-Agent", "LG Player"), 1048576).run();
		verify(item).startPlaying(ADDRESS);
		verify(item).stopPlaying(ADDRESS);
	}

	private void playFilm() throws Exception {
		probe(593310402);
		Runnable previous = get(10252, 2359296);
		selectFilm(); // received while the previous stream is open
		previous.run();
		clearInvocations(item);
		get(817728, 593559552).run(); // TV closed this stream after 5,538,168 ms
		verify(item, atLeastOnce()).startPlaying(ADDRESS);
		verify(item, atLeastOnce()).stopPlaying(ADDRESS);
		get(597752346, 34).run();
	}

	// #7365, 22:50:08.433, .496 and .511. SOAP ObjectID 287#667 and
	// the stream URI /287/... resolve to the same item.
	private void selectFilm() throws Exception {
		browseItem();
		head(CAPTION, "HTTP/1.0");
		browseItem();
	}

	private void browseItem() throws Exception {
		var zero = new UnsignedIntegerFourBytes(0);
		try (var didl = mockStatic(DidlHelper.class)) {
			didl.when(() -> DidlHelper.getDidlResults(List.of(item))).thenReturn("<DIDL-Lite/>");
			assertNotNull(directoryService.browse(soapId, "BrowseMetadata", "*", zero, zero, "", controlPoint));
		}
	}

	private void probe(long tailOffset) throws Exception {
		probe(tailOffset, FIRST_BLOCK);
	}

	private void probe(long tailOffset, long initialBytes) throws Exception {
		probe(tailOffset, initialBytes, size - tailOffset - 8);
	}

	private void probe(long tailOffset, long initialBytes, long tailBytes) throws Exception {
		head(FEATURES, "HTTP/1.1");
		request("GET", "HTTP/1.1", 0L, Map.of(FEATURES, "1", INFO, "1"), initialBytes).run();
		get(0, initialBytes).run();
		get(tailOffset, FIRST_BLOCK).run();
		get(10252, FIRST_BLOCK).run();
		get(tailOffset + 8, tailBytes).run();
	}

	private void head(String header, String protocol) throws Exception {
		request("HEAD", protocol, null, Map.of(header, "1"), 0).run();
	}

	private Runnable get(long offset, long bytes) throws Exception {
		return request("GET", "HTTP/1.1", offset, Map.of(FEATURES, "1"), bytes);
	}

	private Runnable request(String method, String protocol, Long offset, Map<String, String> fields, long bytes) throws Exception {
		Map<String, String> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
		headers.putAll(fields);
		headers.put("Host", "example.test:5001");
		headers.put("Connection", "close");
		if (offset != null) {
			headers.put("Range", "bytes=" + offset + "-");
		}
		var req = mock(HttpServletRequest.class);
		var resp = mock(HttpServletResponse.class);
		var context = mock(AsyncContext.class);
		when(req.getHttpServletMapping()).thenReturn(mock(HttpServletMapping.class));
		when(req.getMethod()).thenReturn(method);
		when(req.getProtocol()).thenReturn(protocol);
		when(req.getRemoteAddr()).thenReturn(ADDRESS);
		String uri = "/ums/media/" + uuid + "/" + item.getId() + "/" + item.getFile().getName();
		when(req.getRequestURI()).thenReturn(uri);
		when(req.getHeader(anyString())).thenAnswer(call -> headers.get((String) call.getArgument(0)));
		when(req.startAsync()).thenReturn(context);
		when(context.getRequest()).thenReturn(req);
		when(context.getResponse()).thenReturn(resp);
		when(resp.getContentType()).thenReturn("video/avi");
		var body = new LimitedOutput(bytes, duringNextTransfer);
		duringNextTransfer = null;
		when(resp.getOutputStream()).thenReturn(body);

		servlet.doGetHead(req, resp);
		verify(resp).setStatus(offset == null ? 200 : 206);
		if (fields.containsKey(FEATURES)) {
			verify(resp).setHeader(eq("ContentFeatures.DLNA.ORG"), anyString());
		}
		if (fields.containsKey(INFO)) {
			verify(resp).setHeader("MediaInfo.sec", "SEC_Duration=" + (long) (item.getMediaInfo().getDurationInSeconds() * 1000));
		}
		if (method.equals("HEAD")) {
			verify(context).complete();
			verify(resp, never()).getOutputStream();
			return () -> { };
		}
		if (offset != null) {
			verify(resp).setHeader("Content-Range", "bytes " + offset + "-" + (size - 1) + "/" + size);
			verify(resp).setContentLengthLong(size - offset);
		}
		if (headers.containsKey("TimeSeekRange.dlna.org")) {
			verify(resp).setHeader(eq("TimeSeekRange.dlna.org"), startsWith("npt=0:30:00.000-"));
		}
		var copy = ArgumentCaptor.forClass(Runnable.class);
		var listener = ArgumentCaptor.forClass(AsyncListener.class);
		verify(context).start(copy.capture());
		verify(context).addListener(listener.capture());
		return () -> {
			copy.getValue().run();
			verify(context).complete();
			try {
				listener.getValue().onComplete(new AsyncEvent(context, req, resp));
			} catch (IOException ex) {
				throw new AssertionError(ex);
			}
			assertEquals(bytes, body.count);
		};
	}

	// The sparse file preserves the recorded lengths and offsets. The sink models
	// disconnects without buffering media or sleeping for the duration of the film.
	@FunctionalInterface
	private interface TransferEvent {
		void run() throws Exception;
	}

	private static final class LimitedOutput extends ServletOutputStream {
		private final long limit;
		private long count;

		private TransferEvent event;

		LimitedOutput(long limit, TransferEvent event) {
			this.limit = limit;
			this.event = event;
		}

		@Override
		public void write(byte[] bytes, int start, int length) throws IOException {
			if (length > limit - count) {
				throw new IOException("Connection reset by peer");
			}
			count += length;
			if (event != null && count >= 524288) {
				try {
					event.run();
				} catch (Exception ex) {
					throw new AssertionError(ex);
				}
				event = null;
			}
		}

		@Override
		public void write(int value) throws IOException {
			if (count == limit) {
				throw new IOException("Connection reset by peer");
			}
			count++;
		}

		@Override
		public boolean isReady() {
			return true;
		}

		@Override
		public void setWriteListener(WriteListener listener) {
			throw new UnsupportedOperationException();
		}
	}
}
