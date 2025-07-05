import {Database} from 'jsr:@db/sqlite'
import {ILoggingProxy} from './Types.ts'

export interface ISqliteOptions {
    /** Name used in logging, useful to differentiate it from other instances. */
    name: string
    /** The directory where the database should or does reside. */
    directory: string
    /** The filename the databased should be stored with. */
    filename: string
    /** Table name : SQL queries to create said table and possible indices and triggers. */
    structure: Record<string, string[]>
    /** The logging proxy object that allows optional import of the SharedUtils Log class. */
    loggingProxy: ILoggingProxy
}


export type TDatabaseQueryInput = null | undefined | number | bigint | string | boolean | Date | Uint8Array | [] | Record<PropertyKey, never>

export interface IDatabaseQuery {
    query: string
    params?: Record<string, TDatabaseQueryInput>
}

export default class Sqlite {
    readonly #options: ISqliteOptions
    readonly #tag: string
    readonly #dbPath: string
    #db: Database
    constructor(options: ISqliteOptions) {
        this.#options = options
        this.#tag = `${this.constructor.name}->${this.#options.name}`
        Deno.mkdirSync(options.directory, {recursive: true})
        this.#dbPath = `${options.directory}/${options.filename}`
        this.#db = this.#create(this.#dbPath)
    }

    // region Lifecycle
    #create(filePath: string): Database {
        const Log = this.#options.loggingProxy
        const db = new Database(filePath, {
            int64: true,
            unsafeConcurrency: true
        })
        if (db.open) {
            const version = db.prepare('select sqlite_version()').value<[string]>()
            Log.i(this.#tag, `Database with SQLite driver connected:`, filePath, version?.pop())

            // Check if table(s) exists
            for(const [table, queries] of Object.entries(this.#options.structure)) {
                const tableName = db.prepare(`
                    SELECT name
                    FROM sqlite_master
                    WHERE type = 'table'
                      AND name = :name`).value({name: table})
                if (!tableName) {
                    for(const sql of queries) db.run(sql)
                    Log.i(this.#tag, 'Table not found, ran import(s).')
                } else {
                    Log.i(this.#tag, 'Table exists:', tableName?.pop())
                }
            }
        } else {
            Log.w(this.#tag, 'Unable to initialize or connect to database!')
        }
        return db
    }

    /**
     *
     */
    reconnect() {
        this.kill()
        this.#db = this.#create(this.#dbPath)
    }

    /**
     * Terminate the DB connection.
     */
    kill() {
        this.#db.close()
    }

    /**
     * Check if the DB is connected.
     */
    test(): boolean {
        return this.#db.open && !!this.queryValue({query: 'SELECT 1;'})
    }

    // endregion

    // region Query
    /**
     * Runs something without selecting anything in the table.
     * @param options
     */
    queryRun(options: IDatabaseQuery): number | object | undefined {
        const Log = this.#options.loggingProxy
        try {
            return this.#db.prepare(options.query).run(options.params)
        } catch (e) {
            Log.e(this.#tag, '', e, options)
        }
    }

    /**
     * Returns a single row.
     * @param options
     */
    queryGet<T>(options: IDatabaseQuery): T | undefined {
        const Log = this.#options.loggingProxy
        try {
            return this.#db.prepare(options.query).get(options.params) as T
        } catch (e) {
            Log.e(this.#tag, '', e, options)
        }
    }

    /**
     * Returns a collection of rows.
     * @param options
     */
    queryAll<T>(options: IDatabaseQuery): T[] | undefined {
        const Log = this.#options.loggingProxy
        try {
            return this.#db.prepare(options.query).all(options.params) as T[]
        } catch (e) {
            Log.e(this.#tag, '', e, options)
        }
    }

    /**
     * Get the first value in the result, will return that value without a key.
     * Used to get a value not in the main table.
     * @param options
     */
    queryValue<T>(options: IDatabaseQuery): T | undefined {
        const Log = this.#options.loggingProxy
        try {
            const arr = this.#db.prepare(options.query).value<T[]>(options.params)
            if (arr) return arr.pop()
        } catch (e) {
            Log.e(this.#tag, '', e, options)
        }
    }

    /**
     * Get the first values in the result, will return those values without keys.
     * Used to get values not in the main table.
     * @param options
     */
    queryValues<T>(options: IDatabaseQuery): T[] | undefined {
        const Log = this.#options.loggingProxy
        try {
            const arr = this.#db.prepare(options.query).values<T[]>(options.params)
            if (arr) return arr.map((it) => {
                return it.pop()
            }).filter((it) => it !== undefined)
        } catch (e) {
            Log.e(this.#tag, '', e, options)
        }
    }

    queryDictionary<T>(options: IDatabaseQuery): Record<string, T> | undefined {
        const Log = this.#options.loggingProxy
        try {
            const dic = this.#db.prepare(options.query).all(options.params)
            if (dic) return Object.fromEntries(
                Object.entries(dic)
                    .map(([a, b]) => [a, b as T])
            )
        } catch (e) {
            Log.e(this.#tag, '', e, options)
        }
    }

    // endregion
}