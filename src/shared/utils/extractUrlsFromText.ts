export default function extractUrlsFromText(text: string): string[] {
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+\.[^\s]+)/gi;
    const matches = text.match(urlRegex);

    return (matches || []).filter((url) => {
        const lastDotIndex = url.lastIndexOf('.');
        return lastDotIndex > 0 && lastDotIndex < url.length - 1;
    });
}
