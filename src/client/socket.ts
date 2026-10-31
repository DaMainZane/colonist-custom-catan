// MODULE: the single socket.io connection shared by all client modules | DEPENDS ON: none | USED BY: client/actions, client/cursors, client/main, client/mapmenu, client/presets, client/render/board, +9 more
export const socket: ReturnType<typeof io> = typeof io !== 'undefined' ? io() : (null as any);
