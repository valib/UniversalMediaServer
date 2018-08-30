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

package net.pms.test;

import ch.qos.logback.classic.LoggerContext;
import net.pms.dlna.DLNAMediaLang;
import net.pms.util.Iso639;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;


/**
 * Test the RendererConfiguration class
 */
public class Iso639Test {

	@BeforeEach
	public void setUp() {
		// Silence all log messages from the PMS code that is being tested
		LoggerContext context = (LoggerContext) LoggerFactory.getILoggerFactory();
		context.reset();
    }

	/**
	 * Test Iso639 class to verify the defined languages.
	 */
	@Test
	public void testCodes() {
		assertNull("No language found for ISO code null", Iso639.getLanguage(null));

		// Reserved keyword "loc" should not match anything
		assertNull("No language found for ISO code \"loc\"", Iso639.getLanguage("loc"));

		// Reserved keyword DLNAMediaLang.UND should match "Undetermined"
		assertEquals("ISO code \"" + DLNAMediaLang.UND + "\" returns \"Undetermined\"",
				"Undetermined", Iso639.getLanguage(DLNAMediaLang.UND));

		assertEquals("ISO code \"en\" returns \"English\"", "English", Iso639.getLanguage("en"));
		assertEquals("ISO code \"eng\" returns \"English\"", "English", Iso639.getLanguage("eng"));
		assertEquals("ISO code \"EnG\" returns \"English\"", "English", Iso639.getLanguage("EnG"));

		// Test codeIsValid()
		assertTrue(Iso639.codeIsValid("en"), "ISO code \"en\" is valid");
		assertTrue(Iso639.codeIsValid("EN"), "ISO code \"EN\" is valid");
		assertTrue(Iso639.codeIsValid("vie"), "ISO code \"vie\" is valid");
		assertTrue(Iso639.codeIsValid("vIe"), "ISO code \"vIe\" is valid");
		assertFalse(Iso639.codeIsValid("en-uk"), "ISO code \"en-uk\" is invalid");
		assertFalse(Iso639.codeIsValid(""), "ISO code \"\" is invalid");
		assertFalse(Iso639.codeIsValid(null), "ISO code null is invalid");

		// Test getISO639_2Code()
		assertEquals("ISO code \"en\" returns \"eng\"", Iso639.getISO639_2Code("en"), "eng");
		assertEquals("ISO code \"eng\" returns \"eng\"", Iso639.getISO639_2Code("eng"), "eng");
		assertNull("ISO code \"loc\" returns null", Iso639.getISO639_2Code("loc"));
		assertNull("ISO code \"\" returns null", Iso639.getISO639_2Code(""));
		assertNull("ISO code null returns null", Iso639.getISO639_2Code(null));

		// Test isCodeMatching()
		assertTrue(Iso639.isCodeMatching("Fulah", "ful"), "ISO code \"ful\" matches language \"Fulah\"");
		assertTrue(Iso639.isCodeMatching("Gaelic (Scots)", "gd"), "ISO code \"gd\" matches language \"Gaelic (Scots)\"");
		assertTrue(Iso639.isCodeMatching("Gaelic (Scots)", "gla"), "ISO code \"gla\" matches language \"Gaelic (Scots)\"");
		assertFalse(Iso639.isCodeMatching("Gaelic (Scots)", "eng"), "ISO code \"eng\" doesn't match language \"Gaelic (Scots)\"");
		assertTrue(Iso639.isCodesMatching("gla", "gd"), "ISO code \"gla\" matches ISO code \"gd\"");
		assertTrue(Iso639.isCodesMatching("ice", "is"), "ISO code \"ice\" matches ISO code \"is\"");
		assertTrue(Iso639.isCodesMatching("isl", "ice"), "ISO code \"isl\" matches ISO code \"ice\"");
		assertFalse(Iso639.isCodesMatching("lav", "en"), "ISO code \"lav\" doesn't match ISO code \"en\"");

		// Test getISOCode()
		assertEquals("ISO code \"eng\" returns ISO code \"en\"", Iso639.getISOCode("eng"), "en");
		assertEquals("ISO code \"ell\" returns ISO code \"el\"", Iso639.getISOCode("ell"), "el");
		assertEquals("ISO code \"gre\" returns ISO code \"el\"", Iso639.getISOCode("gre"), "el");
		assertEquals("ISO code \"gay\" returns ISO code \"gay\"", Iso639.getISOCode("gay"), "gay");
		assertNull("ISO code \"loc\" returns null", Iso639.getISOCode("loc"));
	}
}
