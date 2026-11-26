import java.nio.charset.Charset;
import java.nio.file.Files;
import java.nio.file.Path;
import net.pms.media.subtitle.MediaSubtitle;

/** Runs in a separate JVM with only the assembled UMS JAR on its classpath. */
public class SubtitleLanguageSmoke {
	public static void main(String[] args) throws Exception {
		if (MediaSubtitle.class.getResource("/com/ibm/icu/util/ULocale.class") != null) {
			throw new AssertionError("The distribution contains the full ICU4J library");
		}
		Path fixtures = Path.of(args[0]);
		Path czech = fixtures.resolve("czech-cp1250.srt");
		check(czech, "WINDOWS-1250", "cs");
		check(fixtures.resolve("russian-utf16-le.srt"), "UTF-16LE", "ru");
		Path utf8 = Files.createTempFile("subtitle-language-", ".srt");
		try {
			Files.writeString(utf8, Files.readString(czech, Charset.forName("windows-1250")));
			check(utf8, "UTF-8", "cs");
		} finally {
			Files.deleteIfExists(utf8);
		}
	}

	private static void check(Path file, String encoding, String language) throws Exception {
		MediaSubtitle subtitle = new MediaSubtitle();
		subtitle.setExternalFile(file.toFile());
		if (!encoding.equals(subtitle.getSubCharacterSet()) || !language.equals(subtitle.getLang())) {
			throw new AssertionError(file + " detected as " + subtitle.getSubCharacterSet() + " / " + subtitle.getLang());
		}
	}
}
