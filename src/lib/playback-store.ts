export type CurrentTimeListener = () => void;

let currentTime = 0;
const listeners = new Set<CurrentTimeListener>();

function subscribeCurrentTime(listener: CurrentTimeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getCurrentTime(): number {
  return currentTime;
}

function setCurrentTime(time: number): void {
  if (time === currentTime) return;
  currentTime = time;
  listeners.forEach((listener) => listener());
}

export { subscribeCurrentTime, getCurrentTime, setCurrentTime };
