package naming

// Constellations contains astronomical objects organized by category for session naming.
// Replaces city names to avoid namespace collision with Conductor's workspace naming.
// Future gamification can use these categories for rarity tiers:
// - Zodiac: common
// - Well-known constellations: uncommon
// - Nebulae & clusters: rare
// - Named stars & deep sky: legendary
var Constellations = []string{
	// Zodiac (common tier)
	"aries", "taurus", "gemini", "cancer", "leo", "virgo",
	"libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces",

	// Northern constellations
	"andromeda", "cassiopeia", "perseus", "cepheus", "draco",
	"ursa-major", "ursa-minor", "cygnus", "lyra", "aquila",
	"hercules", "bootes", "corona", "serpens", "ophiuchus",
	"pegasus", "auriga", "orion", "canis-major", "canis-minor",
	"monoceros", "lepus", "columba", "puppis", "vela",
	"carina", "lynx", "vulpecula", "sagitta", "delphinus",
	"equuleus", "lacerta", "triangulum", "camelopardalis", "canes-venatici",
	"scutum", "sextans", "crater", "corvus", "hydra",

	// Southern constellations
	"centaurus", "crux", "phoenix", "tucana", "pavo",
	"grus", "sculptor", "fornax", "eridanus", "caelum",
	"pictor", "dorado", "volans", "chamaeleon", "musca",
	"circinus", "norma", "lupus", "ara", "telescopium",
	"indus", "microscopium", "octans", "apus", "triangulum-australe",
	"reticulum", "horologium", "mensa", "pyxis", "antlia",

	// Nebulae & clusters (rare tier)
	"orion-nebula", "crab-nebula", "eagle-nebula", "ring-nebula",
	"helix-nebula", "owl-nebula", "rosette-nebula", "lagoon-nebula",
	"trifid-nebula", "omega-nebula", "pelican-nebula", "flame-nebula",
	"horsehead", "cats-eye", "eskimo-nebula", "dumbbell-nebula",
	"butterfly-nebula", "tarantula-nebula", "bubble-nebula", "veil-nebula",
	"cone-nebula", "boomerang-nebula", "saturn-nebula", "ghost-nebula",
	"witch-head", "skull-nebula", "ant-nebula", "stingray-nebula",
	"prawn-nebula", "carina-nebula", "cocoon-nebula", "iris-nebula",
	"cave-nebula", "soul-nebula", "heart-nebula", "pacman-nebula",
	"pleiades", "hyades", "praesepe", "omega-centauri",
	"jewel-box", "double-cluster", "wild-duck", "beehive",
	"hercules-cluster", "butterfly-cluster", "ptolemy-cluster", "wishing-well",

	// Named stars (legendary tier)
	"sirius", "canopus", "arcturus", "vega", "capella",
	"rigel", "procyon", "betelgeuse", "altair", "aldebaran",
	"antares", "spica", "pollux", "fomalhaut", "deneb",
	"regulus", "castor", "bellatrix", "alnilam", "alnitak",
	"mintaka", "saiph", "polaris", "mizar", "alcor",
	"dubhe", "merak", "alioth", "alkaid", "thuban",
	"rastaban", "eltanin", "kochab", "pherkad", "schedar",
	"mirfak", "algol", "mira", "achernar", "hadar",
	"acrux", "gacrux", "mimosa", "shaula", "sargas",
	"nunki", "kaus", "alhena", "elnath", "wezen",

	// Deep sky objects & galaxies (legendary tier)
	"andromeda-galaxy", "whirlpool-galaxy", "sombrero-galaxy",
	"pinwheel-galaxy", "sunflower-galaxy", "cartwheel-galaxy",
	"cigar-galaxy", "tadpole-galaxy", "antennae-galaxy",
	"black-eye-galaxy", "spindle-galaxy", "needle-galaxy",
	"fireworks-galaxy", "sculptor-galaxy", "centaurus-a",
	"barnards-star", "proxima", "kepler", "hubble-deep",
	"pillars-of-creation", "cosmic-reef", "mystic-mountain",
	"stellar-nursery", "dark-nebula", "globular", "open-cluster",
	"supernova-remnant", "pulsar", "quasar", "magnetar",
	"neutron-star", "white-dwarf", "red-giant", "blue-giant",
	"binary-star", "ecliptic", "zodiacal", "gegenschein",
	"solstice", "equinox", "perihelion", "aphelion",
	"zenith", "nadir", "meridian", "parallax",
	"parsec", "lightyear", "redshift", "blueshift",
}
