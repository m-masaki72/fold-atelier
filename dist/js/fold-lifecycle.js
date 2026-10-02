import { readSession, writeSession } from './fold-session.js';

export function createSessionController({ snapshot, apply, restoreArtwork, reset, onSave, notify, storage }) {
  const saved = readSession(storage);
  let lastSaved = '';

  return {
    save() {
      const value = snapshot();
      if (!value) return;
      const serialized = JSON.stringify(value);
      if (serialized === lastSaved) return;
      const success = writeSession(value, storage);
      onSave(success);
      if (success) lastSaved = serialized;
    },
    async restore() {
      if (!saved) return;
      try {
        await restoreArtwork(saved.imageKey);
        apply(saved);
        notify('前回の作品と折り具合を再開しました。');
      } catch {
        reset();
        notify('前回の状態を読み込めなかったため、最初の作品を開きました。');
      }
    },
  };
}

export async function startApp({ setInteractive, initialize, restore, activate, onError }) {
  setInteractive(false);
  try {
    await initialize();
    await restore();
    activate();
  } catch (error) {
    onError(error);
  } finally {
    setInteractive(true);
  }
}
