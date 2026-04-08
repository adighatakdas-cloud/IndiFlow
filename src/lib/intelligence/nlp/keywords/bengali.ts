import { IncidentType, WeightedKeyword } from "../types";

/**
 * Bengali keywords for Kolkata traffic classification.
 * Each entry covers either Bengali script or common Roman transliteration
 * as used in Kolkata social media posts and WhatsApp forwards.
 */
export const bengaliKeywords: Record<IncidentType, WeightedKeyword[]> = {
  [IncidentType.JAM]: [
    // Bengali script — primary
    { word: "যানজট", weight: 1.0 },        // traffic jam
    { word: "যান জট", weight: 1.0 },       // traffic jam (spaced)
    { word: "জ্যাম", weight: 0.9 },        // jam
    { word: "যান চলাচল বন্ধ", weight: 1.0 }, // traffic stopped
    { word: "যানবাহন আটকে", weight: 0.9 }, // vehicles stuck
    { word: "দীর্ঘ যানজট", weight: 1.0 },  // long traffic jam
    { word: "তীব্র যানজট", weight: 1.0 },  // severe traffic jam
    { word: "ধীরগতি", weight: 0.8 },       // slow moving
    { word: "গাড়ির লম্বা লাইন", weight: 0.9 }, // long line of vehicles
    { word: "যান চলাচল ব্যাহত", weight: 0.9 }, // traffic disrupted
    { word: "রাস্তা আটকে", weight: 0.8 },  // road blocked
    // Roman transliteration — primary
    { word: "janjot", weight: 1.0 },
    { word: "jaam", weight: 0.9 },
    { word: "jam", weight: 0.7 },
    { word: "traffic janjot", weight: 1.0 },
    { word: "dhirgoti", weight: 0.8 },
    { word: "gari atke", weight: 0.8 },
    { word: "janbahan atke", weight: 0.9 },
    // Secondary Bengali script
    { word: "বিলম্ব", weight: 0.5 },       // delay
    { word: "দেরি", weight: 0.4 },          // late/delay
    { word: "অপেক্ষা", weight: 0.3 },      // waiting
  ],

  [IncidentType.ACCIDENT]: [
    // Bengali script — primary
    { word: "দুর্ঘটনা", weight: 1.0 },     // accident
    { word: "সড়ক দুর্ঘটনা", weight: 1.0 }, // road accident
    { word: "যানবাহন দুর্ঘটনা", weight: 1.0 }, // vehicle accident
    { word: "ধাক্কা", weight: 0.8 },       // collision/hit
    { word: "মুখোমুখি সংঘর্ষ", weight: 1.0 }, // head-on collision
    { word: "সংঘর্ষ", weight: 0.9 },      // collision/clash
    { word: "উল্টে গেছে", weight: 0.9 },  // overturned
    { word: "উল্টে পড়েছে", weight: 0.9 }, // overturned (alternate)
    { word: "বাস উল্টে", weight: 1.0 },   // bus overturned
    { word: "ট্রাক উল্টে", weight: 1.0 }, // truck overturned
    { word: "আহত", weight: 0.6 },          // injured
    { word: "নিহত", weight: 0.7 },         // killed
    { word: "মৃত", weight: 0.6 },          // dead
    { word: "রক্তাক্ত", weight: 0.5 },    // bloodied
    // Roman transliteration — primary
    { word: "durghona", weight: 1.0 },
    { word: "durghotona", weight: 1.0 },
    { word: "durghatona", weight: 1.0 },
    { word: "accident hoyeche", weight: 1.0 },
    { word: "dhakka", weight: 0.7 },
    { word: "sanghorsho", weight: 0.9 },
    { word: "ulte gece", weight: 0.9 },
    { word: "ulte poreche", weight: 0.9 },
    // Secondary Bengali script
    { word: "হাসপাতাল", weight: 0.4 },    // hospital
    { word: "উদ্ধার", weight: 0.4 },       // rescue
  ],

  [IncidentType.SIGNAL]: [
    // Bengali script — primary
    { word: "সিগন্যাল বিকল", weight: 1.0 }, // signal failure
    { word: "ট্রাফিক সিগন্যাল", weight: 0.9 }, // traffic signal
    { word: "সিগন্যাল নষ্ট", weight: 1.0 }, // signal broken
    { word: "সিগন্যাল কাজ করছে না", weight: 1.0 }, // signal not working
    { word: "ট্রাফিক লাইট বন্ধ", weight: 1.0 }, // traffic light off
    { word: "সিগন্যাল খারাপ", weight: 0.9 }, // signal bad/faulty
    { word: "ম্যানুয়াল সিগন্যাল", weight: 0.9 }, // manual signal
    { word: "পুলিশ সিগন্যাল দিচ্ছে", weight: 0.9 }, // police signalling
    // Roman transliteration — primary
    { word: "signal bikal", weight: 1.0 },
    { word: "signal noshto", weight: 1.0 },
    { word: "signal kharap", weight: 0.9 },
    { word: "traffic signal", weight: 0.8 },
    { word: "signal bondho", weight: 1.0 },
    { word: "manual signal", weight: 0.9 },
    // Secondary Bengali script
    { word: "সিগন্যাল", weight: 0.4 },    // signal
    { word: "মোড়", weight: 0.3 },          // crossing/junction
    { word: "চৌরাস্তা", weight: 0.3 },    // crossroads
  ],

  [IncidentType.FLOODING]: [
    // Bengali script — primary
    { word: "জলজট", weight: 1.0 },         // waterlogging
    { word: "জল জমা", weight: 1.0 },       // water accumulation
    { word: "জলাবদ্ধতা", weight: 1.0 },   // waterlogging (formal)
    { word: "রাস্তায় জল", weight: 1.0 },  // water on road
    { word: "বন্যা", weight: 0.9 },        // flood
    { word: "প্লাবিত", weight: 1.0 },     // flooded/inundated
    { word: "ডুবে গেছে", weight: 1.0 },   // submerged
    { word: "হাঁটু সমান জল", weight: 1.0 }, // knee-deep water
    { word: "কোমর সমান জল", weight: 1.0 }, // waist-deep water
    { word: "ভারী বৃষ্টি", weight: 0.7 }, // heavy rain
    { word: "বৃষ্টির জল জমেছে", weight: 0.9 }, // rainwater accumulated
    { word: "নিকাশি ব্যবস্থা বিপর্যস্ত", weight: 0.9 }, // drainage collapsed
    // Roman transliteration — primary
    { word: "joljot", weight: 1.0 },
    { word: "jol joma", weight: 1.0 },
    { word: "jalabaddhata", weight: 1.0 },
    { word: "rastay jol", weight: 1.0 },
    { word: "bonna", weight: 0.9 },
    { word: "plabito", weight: 1.0 },
    { word: "dube gece", weight: 1.0 },
    { word: "hatu soman jol", weight: 1.0 },
    { word: "bhari brishti", weight: 0.6 },
    // Secondary Bengali script
    { word: "বৃষ্টি", weight: 0.3 },      // rain
    { word: "বর্ষা", weight: 0.3 },       // monsoon
  ],

  [IncidentType.DIVERSION]: [
    // Bengali script — primary
    { word: "ডাইভার্সন", weight: 1.0 },   // diversion
    { word: "রুট পরিবর্তন", weight: 1.0 }, // route change
    { word: "রাস্তা বন্ধ", weight: 1.0 }, // road closed
    { word: "রাস্তা বন্ধ আছে", weight: 1.0 }, // road is closed
    { word: "পথ পরিবর্তন", weight: 0.9 }, // path/route change
    { word: "বিকল্প পথ", weight: 0.9 },   // alternative route
    { word: "বিকল্প রুট", weight: 0.9 },  // alternate route
    { word: "লেন বন্ধ", weight: 0.9 },    // lane closed
    { word: "যানবাহন ঘুরিয়ে দেওয়া হচ্ছে", weight: 1.0 }, // vehicles being diverted
    { word: "গাড়ি ঘুরিয়ে দেওয়া", weight: 1.0 }, // vehicles diverted
    { word: "মিছিল", weight: 0.8 },        // procession/rally
    { word: "বিক্ষোভ", weight: 0.6 },     // protest
    { word: "বনধ", weight: 0.9 },          // bandh (shutdown)
    { word: "বন্ধ", weight: 0.5 },         // closed/shut
    { word: "ভিআইপি মুভমেন্ট", weight: 0.8 }, // VIP movement
    // Roman transliteration — primary
    { word: "diversion", weight: 1.0 },
    { word: "rasta bondho", weight: 1.0 },
    { word: "rut poriborton", weight: 1.0 },
    { word: "bikolpo path", weight: 0.9 },
    { word: "gari ghuriye", weight: 1.0 },
    { word: "michil", weight: 0.7 },
    { word: "biksho", weight: 0.6 },
    { word: "bondho", weight: 0.8 },
    { word: "bandh", weight: 0.8 },
    // Secondary Bengali script
    { word: "প্রতিবন্ধকতা", weight: 0.5 }, // obstruction
    { word: "নিষেধাজ্ঞা", weight: 0.5 },  // restriction
  ],

  [IncidentType.UNKNOWN]: [],
};
