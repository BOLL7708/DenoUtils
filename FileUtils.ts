import * as path from 'jsr:@std/path'

export default class FileUtils {
    static ensureDir(anyPath: string): boolean {
        const dirPath = path.dirname(anyPath)
        try {
            Deno.mkdirSync(dirPath, {recursive: true})
        } catch (e) {
            if (e instanceof Deno.errors.AlreadyExists) return true
            if (e instanceof Deno.errors.PermissionDenied) return false
            console.error('Unhandled error when attempting to create directory', e)
            return false
        }
        return true
    }

    /** Will attempt to load a text file from disk, returns undefined if failed. */
    static readText(filepath: string): string | undefined {
        let text = ''
        try {
            text = Deno.readTextFileSync(filepath)
        } catch (e) {
            if (e instanceof Deno.errors.NotFound) return
            if (e instanceof Deno.errors.PermissionDenied) return
            if (e instanceof Deno.errors.IsADirectory) return
            console.error('Unhandled error when attempting to read file', e)
            return
        }
        return text
    }

    static writeText(filepath: string, contents: string): boolean {
        try {
            this.ensureDir(filepath)
            Deno.writeTextFileSync(filepath, contents)
            return true
        } catch (e) {
            if (e instanceof Deno.errors.AlreadyExists) return true
            if (e instanceof Deno.errors.PermissionDenied) return false
            console.error('Unhandled error when attempting to write file', e)
        }
        return false
    }

    static remove(filepath: string): boolean {
        try {
            Deno.removeSync(filepath)
        } catch (e) {
            if (e instanceof Deno.errors.NotFound) return true
            if (e instanceof Deno.errors.PermissionDenied) return false
            if (e instanceof Deno.errors.IsADirectory) return false
            console.error('Unhandled error when attempting to remove file', e)
        }
        return true
    }

    /**
     *
     * @param source
     * @param destination
     */
    static copy(source: string, destination: string): boolean {
        this.ensureDir(destination)
        try {
            Deno.copyFileSync(source, destination)
        } catch(e) {
            if(e instanceof Deno.errors.IsADirectory) return false
            if(e instanceof Deno.errors.PermissionDenied) return false
            console.error('Unhandled error when attempting to copy file', e)
        }
        return true
    }

    static exists(filepath: string): boolean {
        try {
            Deno.lstatSync(filepath)
        } catch (e) {
            if (e instanceof Deno.errors.NotFound) return false
            console.error('Unhandled error when checking if file exists', e)
            return false
        }
        return true
    }
}