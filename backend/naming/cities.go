package naming

// Cities contains world cities organized by region for session naming.
// Future gamification can use these categories for rarity tiers:
// - Capitals: common
// - Major cities: uncommon
// - Remote/obscure: rare
// - Micronations/unusual: legendary
var Cities = []string{
	// North America
	"seattle", "portland", "vancouver", "toronto", "montreal",
	"boston", "chicago", "denver", "austin", "miami",
	"phoenix", "detroit", "atlanta", "dallas", "houston",
	"calgary", "winnipeg", "quebec", "ottawa", "halifax",
	"juneau", "anchorage", "honolulu", "nashville", "memphis",

	// Central America & Caribbean
	"havana", "cancun", "guadalajara", "monterrey", "tijuana",
	"panama", "belize", "kingston", "nassau", "bridgetown",

	// South America
	"bogota", "lima", "quito", "caracas", "santiago",
	"buenos-aires", "montevideo", "asuncion", "la-paz", "sucre",
	"brasilia", "rio", "sao-paulo", "medellin", "cartagena",
	"cusco", "valparaiso", "ushuaia", "patagonia", "manaus",

	// Western Europe
	"london", "paris", "berlin", "amsterdam", "brussels",
	"madrid", "barcelona", "lisbon", "porto", "dublin",
	"edinburgh", "glasgow", "manchester", "birmingham", "leeds",
	"lyon", "marseille", "nice", "bordeaux", "toulouse",
	"munich", "frankfurt", "hamburg", "cologne", "stuttgart",
	"milan", "rome", "florence", "venice", "naples",
	"vienna", "zurich", "geneva", "bern", "basel",

	// Northern Europe
	"oslo", "stockholm", "copenhagen", "helsinki", "reykjavik",
	"bergen", "gothenburg", "malmo", "turku", "tromso",
	"akureyri", "rovaniemi", "tallinn", "riga", "vilnius",

	// Eastern Europe
	"moscow", "kyiv", "warsaw", "prague", "budapest",
	"bucharest", "sofia", "belgrade", "zagreb", "ljubljana",
	"bratislava", "krakow", "gdansk", "minsk", "chisinau",
	"tbilisi", "yerevan", "baku", "odessa", "lviv",

	// Middle East
	"dubai", "abu-dhabi", "doha", "riyadh", "jeddah",
	"tehran", "baghdad", "amman", "beirut", "damascus",
	"jerusalem", "tel-aviv", "muscat", "kuwait", "manama",
	"istanbul", "ankara", "izmir", "antalya", "cappadocia",

	// South Asia
	"mumbai", "delhi", "bangalore", "chennai", "kolkata",
	"hyderabad", "pune", "ahmedabad", "jaipur", "goa",
	"kathmandu", "colombo", "dhaka", "karachi", "lahore",
	"islamabad", "kabul", "thimphu", "malé", "leh",

	// Southeast Asia
	"singapore", "bangkok", "hanoi", "saigon", "jakarta",
	"kuala-lumpur", "manila", "yangon", "phnom-penh", "vientiane",
	"bali", "phuket", "chiang-mai", "danang", "penang",
	"brunei", "dili", "siem-reap", "luang-prabang", "boracay",

	// East Asia
	"tokyo", "osaka", "kyoto", "yokohama", "nagoya",
	"seoul", "busan", "beijing", "shanghai", "guangzhou",
	"shenzhen", "hong-kong", "macau", "taipei", "kaohsiung",
	"sapporo", "fukuoka", "okinawa", "jeju", "xian",

	// Central Asia
	"almaty", "astana", "tashkent", "bishkek", "dushanbe",
	"ashgabat", "samarkand", "bukhara", "khiva", "ulaanbaatar",

	// Africa
	"cairo", "casablanca", "marrakech", "tunis", "algiers",
	"lagos", "accra", "abidjan", "dakar", "nairobi",
	"addis-ababa", "kigali", "kampala", "dar-es-salaam", "zanzibar",
	"cape-town", "johannesburg", "durban", "pretoria", "windhoek",
	"luanda", "kinshasa", "douala", "libreville", "antananarivo",

	// Oceania
	"sydney", "melbourne", "brisbane", "perth", "adelaide",
	"auckland", "wellington", "christchurch", "queenstown", "rotorua",
	"fiji", "samoa", "tonga", "vanuatu", "tahiti",
	"darwin", "cairns", "hobart", "canberra", "gold-coast",

	// Remote & Unusual (future legendary tier)
	"longyearbyen", "nuuk", "faroe", "svalbard", "mcmurdo",
	"easter-island", "galapagos", "pitcairn", "tristan", "kerguelen",
	"siberia", "yakutsk", "kamchatka", "vladivostok", "magadan",
	"lhasa", "ladakh", "bhutan", "sikkim", "darjeeling",
	"petra", "palmyra", "timbuktu", "machu-picchu", "angkor",
	"bora-bora", "maldives", "seychelles", "mauritius", "reunion",
}
