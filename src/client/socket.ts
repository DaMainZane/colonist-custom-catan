export const socket: ReturnType<typeof io> = typeof io !== 'undefined' ? io() : (null as any);
