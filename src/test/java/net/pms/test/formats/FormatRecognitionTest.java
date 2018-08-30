/*
 * PS3 Media Server, for streaming any medias to your PS3.
 * Copyright (C) 2008  A.Brochard
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; version 2
 * of the License only.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 */

package net.pms.test.formats;

import ch.qos.logback.classic.LoggerContext;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;
import java.util.ArrayList;
import java.util.List;
import net.pms.PMS;
import net.pms.configuration.PmsConfiguration;
import net.pms.configuration.RendererConfiguration;
import net.pms.dlna.DLNAMediaAudio;
import net.pms.dlna.DLNAMediaInfo;
import net.pms.dlna.LibMediaInfoParser;
import net.pms.formats.DVRMS;
import net.pms.formats.Format;
import net.pms.formats.ISO;
import net.pms.formats.MKV;
import net.pms.formats.MPG;
import net.pms.formats.audio.M4A;
import net.pms.formats.audio.MP3;
import net.pms.formats.audio.OGA;
import net.pms.formats.audio.WAV;
import net.pms.formats.image.RAW;
import net.pms.network.HTTPResource;
import org.apache.commons.configuration.ConfigurationException;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

/**
 * Test the recognition of formats.
 */
public class FormatRecognitionTest {
	private final static boolean mediaInfoParserIsValid = LibMediaInfoParser.isValid();
	private final static PmsConfiguration configuration = new PmsConfiguration(false);

	@BeforeAll
	public static void setUpBeforeClass() throws ConfigurationException {
		// Silence all log messages from the PMS code that is being tested
		LoggerContext context = (LoggerContext) LoggerFactory.getILoggerFactory();
		context.reset();

		// Initialize the RendererConfiguration
		RendererConfiguration.loadRendererConfigurations(configuration);
	}

    /**
     * Test some basic functionality of {@link RendererConfiguration#isCompatible(DLNAMediaInfo, Format)}
     */
    @Test
	public void testRendererConfigurationBasics() {
    	// This test is only useful if the MediaInfo library is available
		assumeTrue(mediaInfoParserIsValid);
		RendererConfiguration conf = RendererConfiguration.getRendererConfigurationByName("Playstation 3");
		assertNotNull(conf, "Renderer named \"Playstation 3\" found.");
		assertEquals(false,
				conf.isCompatible(null, null, configuration),
				"With nothing provided isCompatible() should return false");
	}

	/**
	 * Test the compatibility of the Playstation 3 with the MP3 format.
	 */
	@Test
	public void testPlaystationAudioMp3Compatibility() {
    	// This test is only useful if the MediaInfo library is available
		assumeTrue(mediaInfoParserIsValid);

		RendererConfiguration conf = RendererConfiguration.getRendererConfigurationByName("Playstation 3");
		assertNotNull(conf, "Renderer named \"Playstation 3\" found.");

		// Construct regular two channel MP3 information
		DLNAMediaInfo info = new DLNAMediaInfo();
		info.setContainer("mp3");
		info.setMimeType(HTTPResource.AUDIO_MP3_TYPEMIME);
		DLNAMediaAudio audio = new DLNAMediaAudio();
		audio.getAudioProperties().setNumberOfChannels(2);
		List<DLNAMediaAudio> audioCodes = new ArrayList<>();
		audioCodes.add(audio);
		info.setAudioTracksList(audioCodes);
		Format format = new MP3();
		format.match("test.mp3");
		assertEquals(true,
				conf.isCompatible(info, format, configuration),
				"PS3 is compatible with MP3");

		// Construct five channel MP3 that the PS3 does not support natively
		audio.getAudioProperties().setNumberOfChannels(5);
		assertEquals(false,
				conf.isCompatible(info, format, configuration),
				"PS3 is incompatible with five channel MP3");
	}

	/**
	 * Test the compatibility of the Playstation 3 with the MPG format.
	 */
	@Test
	public void testPlaystationVideoMpgCompatibility() {
    	// This test is only useful if the MediaInfo library is available
		assumeTrue(mediaInfoParserIsValid);

		RendererConfiguration conf = RendererConfiguration.getRendererConfigurationByName("Playstation 3");
		assertNotNull(conf, "Renderer named \"Playstation 3\" found.");

		// Construct regular two channel MPG information
		DLNAMediaInfo info = new DLNAMediaInfo();
		info.setContainer("avi");
		DLNAMediaAudio audio = new DLNAMediaAudio();
		audio.setCodecA("ac3");
		audio.getAudioProperties().setNumberOfChannels(5);
		List<DLNAMediaAudio> audioCodes = new ArrayList<>();
		audioCodes.add(audio);
		info.setAudioTracksList(audioCodes);
		info.setCodecV("mp4");
		Format format = new MPG();
		format.match("test.avi");
		assertEquals(true,
				conf.isCompatible(info, format, configuration),
				"PS3 is compatible with MPG");

		// Construct MPG with wmv codec that the PS3 does not support natively
		info.setCodecV("wmv");
		assertEquals(false,
				conf.isCompatible(info, format, configuration),
				"PS3 is incompatible with MPG with wmv codec");
	}

	/**
	 * Test the compatibility of the Playstation 3 with the MPG format.
	 */
	@Test
	public void testPlaystationVideoMkvCompatibility() {
    	// This test is only useful if the MediaInfo library is available
		assumeTrue(mediaInfoParserIsValid);

		RendererConfiguration conf = RendererConfiguration.getRendererConfigurationByName("Playstation 3");
		assertNotNull(conf, "Renderer named \"Playstation 3\" found.");

		// Construct MKV information
		DLNAMediaInfo info = new DLNAMediaInfo();
		info.setContainer("mkv");
		DLNAMediaAudio audio = new DLNAMediaAudio();
		audio.setCodecA("ac3");
		audio.getAudioProperties().setNumberOfChannels(5);
		List<DLNAMediaAudio> audioCodes = new ArrayList<>();
		audioCodes.add(audio);
		info.setAudioTracksList(audioCodes);
		info.setCodecV("mp4");
		Format format = new MPG();
		format.match("test.mkv");
		assertEquals(false,
				conf.isCompatible(info, format, configuration),
				"PS3 is incompatible with MKV");
	}

	/**
	 * Test the compatibility of the
	 * {@link Format#isCompatible(DLNAMediaInfo, RendererConfiguration)} for the
	 * Playstation 3 renderer.
	 */
	@Test
	public void testPS3Compatibility() {
    	// This test is only useful if the MediaInfo library is available
		assumeTrue(mediaInfoParserIsValid);

		RendererConfiguration conf = RendererConfiguration.getRendererConfigurationByName("Playstation 3");
		assertNotNull(conf, "Renderer named \"Playstation 3\" found.");

		// DVRMS: false
		DLNAMediaInfo info = new DLNAMediaInfo();
		info.setContainer("dvr");
		Format format = new DVRMS();
		format.match("test.dvr");
		assertFalse(conf.isCompatible(info, format, configuration), "isCompatible() gives the outcome false for DVRMS");

		// ISO: false
		info = new DLNAMediaInfo();
		info.setContainer("iso");
		format = new ISO();
		format.match("test.iso");
		assertFalse(conf.isCompatible(info, format, configuration), "isCompatible() gives the outcome false for ISO");

		// M4A: false
		info = new DLNAMediaInfo();
		info.setContainer("m4a");
		format = new M4A();
		format.match("test.m4a");
		assertTrue(conf.isCompatible(info, format, configuration), "isCompatible() gives the outcome true for M4A");

		// MKV: false
		info = new DLNAMediaInfo();
		info.setContainer("mkv");
		format = new MKV();
		format.match("test.mkv");
		assertFalse(conf.isCompatible(info, format, configuration), "isCompatible() gives the outcome false for MKV");

		// MP3: true
		info = new DLNAMediaInfo();
		info.setContainer("mp3");
		format = new MP3();
		format.match("test.mp3");
		assertTrue(conf.isCompatible(info, format, configuration), "isCompatible() gives the outcome true for MP3");

		// MPG: true
		info = new DLNAMediaInfo();
		info.setContainer("avi");
		format = new MPG();
		format.match("test.mpg");
		assertTrue(conf.isCompatible(info, format, configuration), "isCompatible() gives the outcome true for MPG");

		// OGG: false
		info = new DLNAMediaInfo();
		info.setContainer("ogg");
		format = new OGA();
		format.match("test.ogg");
		assertFalse(conf.isCompatible(info, format, configuration), "isCompatible() gives the outcome false for OGG");

		// RAW: false
		info = new DLNAMediaInfo();
		info.setContainer("raw");
		format = new RAW();
		format.match("test.arw");
		assertFalse(conf.isCompatible(info, format, configuration), "isCompatible() gives the outcome false for RAW");

		// WAV: true
		info = new DLNAMediaInfo();
		info.setContainer("wav");
		format = new WAV();
		format.match("test.wav");
		assertTrue(conf.isCompatible(info, format, configuration), "isCompatible() gives the outcome true for WAV");

		// WEB: type=VIDEO
		info = new DLNAMediaInfo();
		info.setContainer("avi");
		format.setType(Format.VIDEO);
		assertTrue(conf.isCompatible(info, format, configuration), "isCompatible() gives the outcome true for WEB video");
	}

	/**
	 * When PMS is in the process of starting up, something particular happens.
	 * The RootFolder is initialized and several VirtualVideoActions are added
	 * as children. VirtualVideoActions use the MPG format and at the time of
	 * initialization getDefaultRenderer() is used to determine whether or not
	 * the format can be streamed.
	 * <p>
	 * Under these conditions Format.isCompatible() must return true, or
	 * selecting the VirtualVideoAction will result in a "Corrupted data"
	 * message.
	 * <p>
	 * This test verifies the case above.
	 */
	@Test
	public void testVirtualVideoActionInitializationCompatibility() {
		boolean configurationLoaded = false;

		try {
			// Initialize PMS configuration like at initialization time, this
			// is relevant for RendererConfiguration.isCompatible().
			PMS.setConfiguration(new PmsConfiguration());
			configurationLoaded = true;
		} catch (ConfigurationException e) {
			e.printStackTrace();
		}

		// Continue the test if the configuration loaded, otherwise skip it.
		assumeTrue(configurationLoaded);

		// Continue the test if the LibMediaInfoParser can be loaded, otherwise skip it.
		assumeTrue(LibMediaInfoParser.isValid());

		// Construct media info exactly as VirtualVideoAction does
		DLNAMediaInfo info = new DLNAMediaInfo();
		info.setContainer("mpegps");
		List<DLNAMediaAudio> audioCodes = new ArrayList<>();
		info.setAudioTracksList(audioCodes);
		info.setMimeType("video/mpeg");
		info.setCodecV("mpeg2");
		info.setMediaparsed(true);
		Format format = new MPG();
		format.match("test.mpg");

		// Test without rendererConfiguration, as can happen when plugins
		// create virtual video actions under a folder.

		assertEquals(true, format.isCompatible(info, null), "VirtualVideoAction is initialized as compatible with null configuration");
	}

}
