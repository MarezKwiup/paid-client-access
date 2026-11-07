import { vi } from 'vitest';

type Result = { data: unknown; error: unknown };

const CHAIN_METHODS = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'is', 'in', 'lte', 'gte', 'order', 'limit',
] as const;

const EMPTY: Result = { data: null, error: null };
const INVALID_USER = {
    data: {
        user: null,
    },
    error: {
        message: 'invalid token'
    }
};

function createFakeSupabase() {
    let tables: Record<string, Result> = {};
    const calls: { table: string; method: string; args: unknown[] }[] = [];

    const rpc = vi.fn(async (_fn: string, _args?: unknown): Promise<Result> => EMPTY);
    const getUser = vi.fn(async (_token: string): Promise<unknown> => INVALID_USER);

    function from(table: string) {
        const result = (): Result => tables[table] ?? EMPTY;
        const builder: Record<string, unknown> = {
            maybeSingle: async () => result(),
            single: async () => result(),
            then: (onFulfilled: (r: Result) => unknown, onRejected?: (e: unknown) => unknown) =>
                Promise.resolve(result()).then(onFulfilled, onRejected),
        };
        for (const method of CHAIN_METHODS) {
            builder[method] = (...args: unknown[]) => {
                calls.push({ table, method, args });
                return builder;
            };
        }
        return builder;
    }

    return {
        client: { from, rpc, auth: { getUser }},
        rpc,
        getUser,
        calls,
        setTable(table: string, data: unknown, error: unknown = null) {
            tables[table] = { data, error };
        },
        wrote(table: string, method: string) {
            return calls.some((c) => c.table === table && c.method === method);
        },
        filteredBy(table: string, column: string, value: unknown) {
            return calls.some((c) => c.table === table && c.method === 'eq' && c.args[0] === column && c.args[1] === value);
        },
        reset() {
            tables = {},
            calls.length = 0;
            rpc.mockReset();
            rpc.mockResolvedValue(EMPTY);
            getUser.mockReset();
            getUser.mockResolvedValue(INVALID_USER);
        },
    };
}

export const fakeSupabase = createFakeSupabase();
