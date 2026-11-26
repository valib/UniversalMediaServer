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
package net.pms.media.subtitle;

import com.github.pemistahl.lingua.api.Language;
import com.github.pemistahl.lingua.api.LanguageDetector;
import com.github.pemistahl.lingua.api.LanguageDetectorBuilder;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.Reader;
import java.nio.charset.Charset;
import java.nio.file.Files;
import java.util.Locale;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import net.pms.formats.v2.SubtitleType;
import net.pms.media.MediaLang;
import org.apache.commons.io.IOUtils;
import org.jsoup.Jsoup;

final class SubtitleLanguage {
	private static final int SAMPLE_CHARS = 16 * 1024;
	private static final int MIN_LETTERS = 15;
	private static final Pattern OVERRIDES = Pattern.compile("\\{[^{}]*}");
	private static final Pattern FRAMES = Pattern.compile("^\\{\\d+}\\{\\d+}");
	private static final Pattern CUE_TIMING = Pattern.compile("^(?:\\d+:)?\\d{2}:\\d{2}[.,]\\d+\\s*-->.*");

	private SubtitleLanguage() {
	}

	private static final class DetectorHolder {
		private static final LanguageDetector INSTANCE = LanguageDetectorBuilder.fromAllLanguages()
			.withLowAccuracyMode()
			.withMinimumRelativeDistance(0.05)
			.build();

		private DetectorHolder() {
		}
	}

	static String detect(File file, SubtitleType type, String encoding) throws IOException {
		if (!type.isText() || !Charset.isSupported(encoding)) {
			return MediaLang.UND;
		}
		char[] buffer = new char[SAMPLE_CHARS];
		int count;
		try (Reader reader = new InputStreamReader(Files.newInputStream(file.toPath()), Charset.forName(encoding))) {
			count = IOUtils.read(reader, buffer);
		}
		String sample = new String(buffer, 0, count).replace("\uFEFF", "");
		String dialogue = switch (type) {
			case SUBRIP, WEBVTT -> cueText(sample);
			case ASS -> sample.lines()
				.filter(line -> line.regionMatches(true, 0, "Dialogue:", 0, 9))
				.map(line -> line.split(",", 10))
				.filter(fields -> fields.length == 10)
				.map(fields -> OVERRIDES.matcher(fields[9]).replaceAll(" ")
					.replace("\\N", " ").replace("\\n", " ").replace("\\h", " "))
				.collect(Collectors.joining(" "));
			case MICRODVD -> sample.lines()
				.filter(line -> FRAMES.matcher(line).find())
				.map(line -> OVERRIDES.matcher(line).replaceAll(" ").replace('|', ' '))
				.collect(Collectors.joining(" "));
			case SAMI -> Jsoup.parse(sample).select("body p").text();
			case TEXT -> sample;
			default -> "";
		};
		String text = type == SubtitleType.SAMI ? dialogue : Jsoup.parseBodyFragment(dialogue).text();
		if (text.codePoints().filter(Character::isLetter).limit(MIN_LETTERS).count() < MIN_LETTERS) {
			return MediaLang.UND;
		}
		Language language = DetectorHolder.INSTANCE.detectLanguageOf(text);
		return language == Language.UNKNOWN ? MediaLang.UND : language.getIsoCode639_1().name().toLowerCase(Locale.ROOT);
	}

	private static String cueText(String sample) {
		StringBuilder text = new StringBuilder();
		boolean inCue = false;
		for (String line : sample.split("\\R")) {
			String content = line.strip();
			if (content.isEmpty()) {
				inCue = false;
			} else if (CUE_TIMING.matcher(content).matches()) {
				inCue = true;
			} else if (inCue) {
				text.append(content).append(' ');
			}
		}
		return text.toString();
	}
}
