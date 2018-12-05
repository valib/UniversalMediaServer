package net.pms.dlna;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public class Genre {
	private static final Map<String, String> genre;

	static {
		Map<String, String> valueToString = new HashMap<String, String>();
		valueToString.put("Genre_000", "Blues");
		valueToString.put("Genre_001", "Classic Rock");
		valueToString.put("Genre_002", "Country");
		valueToString.put("Genre_003", "Dance");
		valueToString.put("Genre_004", "Disco");
		valueToString.put("Genre_005", "Funk");
		valueToString.put("Genre_006", "Grunge");
		valueToString.put("Genre_007", "Hip-Hop");
		
		genre = Collections.unmodifiableMap(valueToString);
	}
	
	public Map<String, String> getGenreMap() {
		return genre;
		
	}

	public String value(String key) {
		return genre.get(key);
	}

	/**
	Genre_002;Country
	Genre_003;Dance
	Genre_004;Disco
	Genre_005;Funk
	Genre_006;Grunge
	Genre_007;Hip-Hop
	Genre_008;Jazz
	Genre_009;Metal
	Genre_010;New Age
	Genre_011;Oldies
	Genre_012;Other
	Genre_013;Pop
	Genre_014;R&B
	Genre_015;Rap
	Genre_016;Reggae
	Genre_017;Rock
	Genre_018;Techno
	Genre_019;Industrial
	Genre_020;Alternative
	Genre_021;Ska
	Genre_022;Death Metal
	Genre_023;Pranks
	Genre_024;Soundtrack
	Genre_025;Euro-Techno
	Genre_026;Ambient
	Genre_027;Trip-Hop
	Genre_028;Vocal
	Genre_029;Jazz+Funk
	Genre_030;Fusion
	Genre_031;Trance
	Genre_032;Classical
	Genre_033;Instrumental
	Genre_034;Acid
	Genre_035;House
	Genre_036;Game
	Genre_037;Sound Clip
	Genre_038;Gospel
	Genre_039;Noise
	Genre_040;AlternRock
	Genre_041;Bass
	Genre_042;Soul
	Genre_043;Punk
	Genre_044;Space
	Genre_045;Meditative
	Genre_046;Instrumental Pop
	Genre_047;Instrumental Rock
	Genre_048;Ethnic
	Genre_049;Gothic
	Genre_050;Darkwave
	Genre_051;Techno-Industrial
	Genre_052;Electronic
	Genre_053;Pop-Folk
	Genre_054;Eurodance
	Genre_055;Dream
	Genre_056;Southern Rock
	Genre_057;Comedy
	Genre_058;Cult
	Genre_059;Gangsta
	Genre_060;Top 40
	Genre_061;Christian Rap
	Genre_062;Pop/Funk
	Genre_063;Jungle
	Genre_064;Native American
	Genre_065;Cabaret
	Genre_066;New Wave
	Genre_067;Psychadelic
	Genre_068;Rave
	Genre_069;Showtunes
	Genre_070;Trailer
	Genre_071;Lo-Fi
	Genre_072;Tribal
	Genre_073;Acid Punk
	Genre_074;Acid Jazz
	Genre_075;Polka
	Genre_076;Retro
	Genre_077;Musical
	Genre_078;Rock & Roll
	Genre_079;Hard Rock
	Genre_080;Folk
	Genre_081;Folk-Rock
	Genre_082;National Folk
	Genre_083;Swing
	Genre_084;Fast Fusion
	Genre_085;Bebob
	Genre_086;Latin
	Genre_087;Revival
	Genre_088;Celtic
	Genre_089;Bluegrass
	Genre_090;Avantgarde
	Genre_091;Gothic Rock
	Genre_092;Progressive Rock
	Genre_093;Psychedelic Rock
	Genre_094;Symphonic Rock
	Genre_095;Slow Rock
	Genre_096;Big Band
	Genre_097;Chorus
	Genre_098;Easy Listening
	Genre_099;Acoustic
	Genre_100;Humour
	Genre_101;Speech
	Genre_102;Chanson
	Genre_103;Opera
	Genre_104;Chamber Music
	Genre_105;Sonata
	Genre_106;Symphony
	Genre_107;Booty Bass
	Genre_108;Primus
	Genre_109;Porn Groove
	Genre_110;Satire
	Genre_111;Slow Jam
	Genre_112;Club
	Genre_113;Tango
	Genre_114;Samba
	Genre_115;Folklore
	Genre_116;Ballad
	Genre_117;Power Ballad
	Genre_118;Rhythmic Soul
	Genre_119;Freestyle
	Genre_120;Duet
	Genre_121;Punk Rock
	Genre_122;Drum Solo
	Genre_123;A capella
	Genre_124;Euro-House
	Genre_125;Dance Hall
	Genre_126;Goa
	Genre_127;Drum & Bass
	Genre_128;Club-House
	Genre_129;Hardcore
	Genre_130;Terror
	Genre_131;Indie
	Genre_132;Britpop
	Genre_133;Negerpunk
	Genre_134;Polsk Punk
	Genre_135;Beat
	Genre_136;Christian Gangsta Rap
	Genre_137;Heavy Metal
	Genre_138;Black Metal
	Genre_139;Crossover
	Genre_140;Contemporary Christian
	Genre_141;Christian Rock 
	Genre_142;Merengue
	Genre_143;Salsa
	Genre_144;Trash Metal
	Genre_145;Anime
	Genre_146;JPop
	Genre_147;Synthpop
	*/
}

