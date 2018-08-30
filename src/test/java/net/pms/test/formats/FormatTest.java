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
import net.pms.formats.*;
import net.pms.formats.audio.AIFF;
import net.pms.formats.audio.FLAC;
import net.pms.formats.audio.MP3;
import net.pms.formats.audio.WAV;
import net.pms.formats.audio.WMA;
import net.pms.formats.image.GIF;
import net.pms.formats.image.JPG;
import net.pms.formats.image.PNG;
import net.pms.formats.image.RAW;
import net.pms.formats.image.TIFF;
import static org.junit.jupiter.api.Assertions.assertEquals;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

/**
 * Test basic functionality of {@link Format}.
 */
public class FormatTest {
	@BeforeEach
	public void setUp() {
		// Silence all log messages from the PMS code that is being tested
		LoggerContext context = (LoggerContext) LoggerFactory.getILoggerFactory();
        context.reset();
	}

    /**
     * Test edge cases for {@link Format#match(String)}.
     */
    @Test
	public void testFormatEdgeCases() {
    	// Empty string
		assertEquals(false, new MP3().match(""), "MP3 does not match \"\"");

    	// Null string
		assertEquals(false, new MP3().match(null), "MP3 does not match null");

		// Mixed case
		assertEquals(true, new TIFF().match("tEsT.TiFf"), "TIFF matches \"tEsT.TiFf\"");

		// Starting with identifier instead of ending
		assertEquals(false, new TIFF().match("tiff.test"), "TIFF does not match \"tiff.test\"");

		// Substring
		assertEquals(false, new TIFF().match("not.tiff.but.mp3"), "TIFF does not match \"not.tiff.but.mp3\"");
    }

    /**
     * Test if {@link Format#match(String)} manages to match the identifiers
     * specified in each format with getId().
     */
    @Test
	public void testFormatIdentifiers() {
		// Identifier tests based on the identifiers defined in getId() of each class
		assertEquals(true, new DVRMS().match("test.dvr"), "DVRMS matches \"test.dvr\"");
		assertEquals(true, new AIFF().match("test.aiff"), "AIFF matches \"test.aiff\"");
		assertEquals(true, new FLAC().match("test.flac"), "FLAC matches \"test.flac\"");
		assertEquals(true, new GIF().match("test.gif"), "GIF matches \"test.gif\"");
		assertEquals(true, new ISO().match("test.iso"), "ISO matches \"test.iso\"");
		assertEquals(true, new JPG().match("test.jpg"), "JPG matches \"test.jpg\"");
		assertEquals(true, new WMA().match("test.wma"), "WMA matches \"test.wma\"");
		assertEquals(true, new MKV().match("test.mkv"), "MKV matches \"test.mkv\"");
		assertEquals(true, new MP3().match("test.mp3"), "MP3 matches \"test.mp3\"");
		assertEquals(true, new MPG().match("test.mpg"), "MPG matches \"test.mpg\"");
		assertEquals(true, new OGG().match("test.ogg"), "OGG matches \"test.ogg\"");
		assertEquals(true, new PNG().match("test.png"), "PNG matches \"test.png\"");
		assertEquals(true, new RAW().match("test.arw"), "RAW matches \"test.arw\"");
		assertEquals(true, new TIFF().match("test.tiff"), "TIF matches \"test.tiff\"");
		assertEquals(true, new WAV().match("test.wav"), "WAV matches \"test.wav\"");
		assertEquals(true, new WEB().match("http://test.org/"), "WEB matches \"http\"");
	}
}
