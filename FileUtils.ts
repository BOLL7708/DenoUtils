export default class FileUtils {
    static loadTextFile(path: string): string|undefined {
        let bytes: Uint8Array = new Uint8Array(0)
        try {
            bytes = Deno.readFileSync(path)
        } catch(e) {
            console.error(e)
            return
        }
        const decoder = new TextDecoder("utf-8")
        return decoder.decode(bytes)
    }
}