import { buildDailyReminder } from '../outputs/garden-reliability.js';

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(405).setHeader('Allow', 'GET, HEAD').end();
  const time = req.query?.time || '09:00';
  try {
    const calendar = buildDailyReminder({ time });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `${req.query?.download === '1' ? 'attachment' : 'inline'}; filename="garden-daily-reminder.ics"`);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).end(req.method === 'HEAD' ? '' : calendar);
  } catch {
    return res.status(400).end('Choose a valid reminder time, such as 09:00.');
  }
}
