import * as chrono from 'chrono-node';

/**
 * Indonesian to English time phrase mapping
 */
const indonesianTimeMap: Record<string, string> = {
    // Time units
    detik: 'seconds',
    menit: 'minutes',
    jam: 'hours',
    hari: 'days',
    minggu: 'weeks',
    bulan: 'months',
    tahun: 'years',

    // Relative days
    besok: 'tomorrow',
    lusa: 'day after tomorrow',
    kemarin: 'yesterday',
    sekarang: 'now',

    // Relative time
    lagi: 'from now',
    yang: '',
    akan: '',
    depan: 'next',
    nanti: 'later',

    // Days of week
    senin: 'monday',
    selasa: 'tuesday',
    rabu: 'wednesday',
    kamis: 'thursday',
    jumat: 'friday',
    sabtu: 'saturday',
    ahad: 'sunday',

    // Months
    januari: 'january',
    februari: 'february',
    maret: 'march',
    april: 'april',
    mei: 'may',
    juni: 'june',
    juli: 'july',
    agustus: 'august',
    september: 'september',
    oktober: 'october',
    november: 'november',
    desember: 'december',

    // Time of day (pagi, siang, sore, malam)
    pagi: 'morning',
    siang: 'noon',
    sore: 'afternoon',
    malam: 'night',
};

/**
 * Time of day to hour mapping (WIB)
 */
const timeOfDayHours: Record<string, number> = {
    pagi: 8, // 08:00
    siang: 12, // 12:00
    sore: 16, // 16:00
    malam: 20, // 20:00
};

/**
 * Translate Indonesian time phrase to English for chrono-node parsing
 */
export function translateIndonesianToEnglish(text: string): string {
    let translated = text.toLowerCase().trim();

    // Handle "pukul HH:MM" or "jam HH:MM" pattern
    translated = translated.replace(/pukul\s+(\d{1,2})[:.]?(\d{2})?/gi, 'at $1:$2');
    translated = translated.replace(/jam\s+(\d{1,2})\s*(pagi|siang|sore|malam)?/gi, (match, hour, timeOfDay) => {
        if (timeOfDay) {
            // Adjust hour based on time of day
            let h = parseInt(hour);
            if (timeOfDay === 'sore' || timeOfDay === 'malam') {
                if (h < 12) h += 12;
            }
            return `at ${h}:00`;
        }
        return `${hour} hours`;
    });

    // Handle compound phrases first (before splitting into words)
    translated = translated.replace(/minggu\s+depan/gi, 'next week');
    translated = translated.replace(/bulan\s+depan/gi, 'next month');
    translated = translated.replace(/tahun\s+depan/gi, 'next year');

    // Handle "besok pagi/siang/sore/malam"
    const besokPattern = /besok\s+(pagi|siang|sore|malam)/gi;
    translated = translated.replace(besokPattern, (match, timeOfDay) => {
        const hour = timeOfDayHours[timeOfDay] || 9;
        return `tomorrow at ${hour}:00`;
    });

    // Handle "lusa pagi/siang/sore/malam"
    const lusaPattern = /lusa\s+(pagi|siang|sore|malam)/gi;
    translated = translated.replace(lusaPattern, (match, timeOfDay) => {
        const hour = timeOfDayHours[timeOfDay] || 9;
        return `day after tomorrow at ${hour}:00`;
    });

    // Handle "[number] [unit] lagi" pattern
    translated = translated.replace(/(\d+)\s+(\w+)\s+lagi/gi, (match, num, unit) => {
        const englishUnit = indonesianTimeMap[unit.toLowerCase()] || unit;
        return `${num} ${englishUnit} from now`;
    });

    // Handle "dalam [number] [unit]" pattern
    translated = translated.replace(/dalam\s+(\d+)\s+(\w+)/gi, (match, num, unit) => {
        const englishUnit = indonesianTimeMap[unit.toLowerCase()] || unit;
        return `in ${num} ${englishUnit}`;
    });

    // Replace individual Indonesian words with English equivalents
    Object.entries(indonesianTimeMap).forEach(([indonesian, english]) => {
        const regex = new RegExp(`\\b${indonesian}\\b`, 'gi');
        translated = translated.replace(regex, english);
    });

    return translated.trim();
}

/**
 * Parse Indonesian date/time string and return Date object
 * @param text Indonesian time phrase (e.g., "besok pagi", "2 jam lagi", "jumat jam 9 pagi")
 * @param referenceDate Reference date for relative parsing (defaults to now in WIB)
 * @param timezone Timezone offset in hours (defaults to 7 for WIB)
 */
export function parseIndonesianDate(
    text: string,
    referenceDate?: Date,
    timezone: number = 7
): Date | null {
    // Translate Indonesian to English
    const englishText = translateIndonesianToEnglish(text);

    // Create reference date in WIB timezone if not provided
    const refDate = referenceDate || new Date();

    // Adjust reference date to WIB timezone
    const utcOffset = refDate.getTimezoneOffset() * 60000;
    const wibOffset = timezone * 3600000;
    const wibDate = new Date(refDate.getTime() + utcOffset + wibOffset);

    // Parse with chrono-node
    const parsed = chrono.parse(englishText, wibDate);

    if (parsed.length === 0) {
        return null;
    }

    // Get the first parsed date
    const result = parsed[0].start.date();

    // Adjust back from WIB to local time
    return new Date(result.getTime() - utcOffset - wibOffset);
}

/**
 * Format date in Indonesian locale
 */
export function formatIndonesianDate(date: Date): string {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const months = [
        'Januari',
        'Februari',
        'Maret',
        'April',
        'Mei',
        'Juni',
        'Juli',
        'Agustus',
        'September',
        'Oktober',
        'November',
        'Desember',
    ];

    // Convert stored UTC time to WIB explicitly (UTC+7) without relying on server local timezone
    const wibDate = new Date(date.getTime() + 7 * 60 * 60 * 1000);

    // Use UTC getters on the offset date to avoid double timezone application
    const dayName = days[wibDate.getUTCDay()];
    const day = wibDate.getUTCDate();
    const month = months[wibDate.getUTCMonth()];
    const year = wibDate.getUTCFullYear();
    const hours = wibDate.getUTCHours().toString().padStart(2, '0');
    const minutes = wibDate.getUTCMinutes().toString().padStart(2, '0');

    return `${dayName}, ${day} ${month} ${year} pukul ${hours}:${minutes} WIB`;
}
