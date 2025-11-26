import {proto} from 'baileys';
import {CommandInfo, CommandInterface} from '../handlers/CommandInterface.js';
import {BotConfig} from '../../infrastructure/config/config.js';
import {WebSocketInfo} from '../../shared/types/types.js';
import {SessionService} from '../../domain/services/SessionService.js';
import {createFetchClient} from '../../shared/utils/fetchClient.js';

export interface APIResponse<T> {
    success: boolean;
    data?: T;
    error?: {
        message: string;
        code: string;
    };
    timestamp: string;
    request_id?: string;
}

export interface ServiceInfo {
    name: string;
    description: string;
    version: string;
}

export interface ServicesResponse {
    services: ServiceInfo[];
}

export interface TrackingRecordLocation {
    location_name: string;
    full_address: string;
    lng: string;
    lat: string;
}

export interface TrackingRecord {
    tracking_code: string;
    tracking_name: string;
    description: string;
    buyer_description: string;
    seller_description: string;
    milestone_code: number;
    milestone_name: string;
    current_location: TrackingRecordLocation;
    next_location: TrackingRecordLocation;
    actual_time: number;

    [key: string]: any;
}

export interface SPXTrackingResponse {
    awb: string;
    deliver_type: number;
    receiver_name: string;
    records: TrackingRecord[];
}

const BASE_URL = 'https://cekresi.razik.net';

export class CekResiCommand extends CommandInterface {
    static commandInfo: CommandInfo = {
        name: 'cekresi',
        aliases: ['resi', 'tracking', 'lacak'],
        description: 'Cek status pengiriman paket (resi) dari berbagai kurir.',
        helpText: `*Cara pakai:* 📦
• *${BotConfig.prefix}cekresi <kurir> <nomor_resi>*

*Kurir yang didukung:*
• *spx* / *shopee* — Shopee Express

*Contoh:*
• ${BotConfig.prefix}cekresi spx SPXID123456789
• ${BotConfig.prefix}resi shopee SPXID123456789
• ${BotConfig.prefix}tracking spx SPXID123456789

📌 *Catatan:*
• Masukkan nomor resi tanpa spasi
• Data tracking real-time dari server kurir`,
        category: 'utility',
        commandClass: CekResiCommand,
        cooldown: 5000,
        maxUses: 3,
        vipBypassCooldown: true,
    };
    private client = createFetchClient({
        baseURL: BASE_URL,
        timeout: 30000,
        headers: {
            'Content-Type': 'application/json',
        },
    });

    async handleCommand(
        args: string[],
        jid: string,
        user: string,
        sock: WebSocketInfo,
        sessionService: SessionService,
        msg: proto.IWebMessageInfo
    ): Promise<void> {
        if (args.length < 2) {
            await sock.sendMessage(jid, {
                text: `❌ *Format salah!*\n\nGunakan: *${BotConfig.prefix}cekresi <kurir> <nomor_resi>*\n\nKurir yang didukung: spx/shopee\n\nContoh: ${BotConfig.prefix}cekresi spx SPXID123456789`,
            });
            return;
        }

        const courier = args[0].toLowerCase();
        const resiNumber = args[1].toUpperCase();

        // Fetch available services
        let availableServices: string[] = [];
        try {
            const servicesResponse = await this.client.get<APIResponse<ServicesResponse>>('/');
            if (servicesResponse.data.success && servicesResponse.data.data) {
                availableServices = servicesResponse.data.data.services.map(s => s.name);
            }
        } catch (error) {
            console.error('Error fetching services:', error);
            // Continue with default service
            availableServices = ['spx'];
        }

        // Normalize courier name
        let normalizedCourier = courier;
        if (courier === 'shopee') {
            normalizedCourier = 'spx';
        }

        // Check if courier is supported
        if (!availableServices.includes(normalizedCourier)) {
            await sock.sendMessage(jid, {
                text: `❌ *Kurir tidak didukung!*\n\nKurir yang tersedia: ${availableServices.join(', ')}`,
            });
            return;
        }

        await sock.sendMessage(jid, {
            text: `🔍 Mencari informasi paket...\n📦 Kurir: ${normalizedCourier.toUpperCase()}\n🔢 Resi: ${resiNumber}`,
        });

        try {
            const trackingInfo = await this.trackPackage(normalizedCourier, resiNumber);
            await sock.sendMessage(jid, {
                text: trackingInfo,
            });
        } catch (error) {
            console.error('Error tracking resi:', error);
            await sock.sendMessage(jid, {
                text: `❌ *Gagal melacak paket!*\n\n${error instanceof Error ? error.message : 'Terjadi kesalahan saat mengambil data tracking.'}`,
            });
        }
    }

    private async trackPackage(courier: string, resiNumber: string): Promise<string> {
        try {
            // Make POST request to track package
            const response = await this.client.post<APIResponse<SPXTrackingResponse>>('/', {
                awb: resiNumber,
                exp: courier,
            });

            // Check if request was successful
            if (!response.data.success) {
                throw new Error(response.data.error?.message || 'Gagal melacak paket');
            }

            const data = response.data.data;
            if (!data) {
                throw new Error('Data tracking tidak tersedia');
            }

            // Format response based on courier
            if (courier === 'spx') {
                return this.formatSPXResponse(data);
            }

            // Fallback for other couriers (future support)
            throw new Error(`Format tracking untuk kurir ${courier} belum didukung`);
        } catch (error: any) {
            console.error(`${courier.toUpperCase()} Tracking Error:`, error);

            // Handle FetchError with response data
            if (error.response?.data?.error) {
                throw new Error(error.response.data.error.message || 'Gagal melacak paket');
            }

            throw new Error(error.message || `Gagal melacak paket ${courier.toUpperCase()}. Pastikan nomor resi benar.`);
        }
    }

    private formatSPXResponse(data: SPXTrackingResponse): string {
        if (!data.records || data.records.length === 0) {
            throw new Error('Nomor resi tidak ditemukan atau belum ada update.');
        }

        // Map deliver_type number to text
        const deliverTypeMap: Record<number, string> = {
            0: 'Perlu Dikirim',
            1: 'Dalam Proses Pengiriman',
            2: 'Dalam Pengiriman',
            3: 'Terkirim'
        };
        const deliverTypeText = deliverTypeMap[data.deliver_type] || 'N/A';

        let message = `📦 *TRACKING SHOPEE EXPRESS*\n\n`;
        message += `🔢 *AWB:* ${data.awb}\n`;
        message += `👤 *Penerima:* ${data.receiver_name || 'N/A'}\n`;
        message += `📝 *Tipe:* ${deliverTypeText}\n\n`;
        message += `━━━━━━━━━━━━━━━━\n\n`;

        // Sort records by actual_time (newest first)
        const sortedRecords = [...data.records].sort((a, b) => b.actual_time - a.actual_time);

        sortedRecords.forEach((record, index) => {
            const status = record.milestone_name || record.tracking_name;
            const description = record.buyer_description || record.description || 'N/A';
            const location = record.current_location?.location_name || 'N/A';

            // Format timestamp
            const timestamp = record.actual_time
                ? new Date(record.actual_time * 1000).toLocaleString('id-ID', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: 'Asia/Jakarta'
                })
                : record.tracking_code || 'N/A';

            message += `*${index + 1}. ${status}*\n`;
            message += `📍 ${location}\n`;
            message += `📝 ${description}\n`;
            message += `⏰ ${timestamp}\n\n`;
        });

        message += `━━━━━━━━━━━━━━━━\n`;
        message += `✅ *Status terkini:* ${sortedRecords[0]?.milestone_name || 'Unknown'}`;

        return message;
    }
}

