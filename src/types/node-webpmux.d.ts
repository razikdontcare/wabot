declare module 'node-webpmux' {
    export class Image {
        exif: Buffer | null;
        iccp: Buffer | null;
        xmp: Buffer | null;
        width: number;
        height: number;
        type: number;
        hasAnim: boolean;

        constructor();

        static getEmptyImage(): Promise<Image>;

        static generateFrame(options: { img?: Image; path?: string; buffer?: Buffer }): Promise<any>;

        static save(path: string | null, options: any): Promise<Buffer>;

        load(buffer: Buffer | string): Promise<void>;

        save(path: string | null, options?: any): Promise<Buffer>;
    }

    export const TYPE_LOSSY: number;
    export const TYPE_LOSSLESS: number;
    export const TYPE_EXTENDED: number;
}

