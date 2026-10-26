import { stageGardenMove } from './garden-move.js?v=16';

async function receive() {
  try {
    const data = document.getElementById('garden-move-data');
    await stageGardenMove(JSON.parse(data.textContent));
    location.replace(`/outputs/brittanys-garden-cozy-companion.html${data.dataset.next}`);
  } catch {
    document.getElementById('move-title').textContent = 'Keep the old Garden app';
    document.getElementById('move-message').textContent = 'This address could not keep the moved copy on your device. The old app still holds the original. Allow site storage or free device space, then try again.';
    document.getElementById('move-actions').hidden = false;
  }
}
document.getElementById('move-retry').addEventListener('click', receive);
void receive();
