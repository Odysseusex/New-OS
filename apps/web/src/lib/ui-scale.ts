// The size of everything on screen, chosen per device (a monoblock whose Windows
// cannot go below 100 % shows the till too large). The app is laid out in rem,
// so scaling the root font size scales text, spacing and buttons together while
// full-screen heights stay full-screen. Kept in this device's browser only.
export const UI_SCALE_STEPS = [70, 75, 80, 85, 90, 95, 100, 110, 120];
const KEY = "ui-scale";

export function readUiScale(): number {
  try {
    const value = Number(localStorage.getItem(KEY));
    return UI_SCALE_STEPS.includes(value) ? value : 100;
  } catch {
    return 100;
  }
}

export function applyUiScale(percent: number) {
  document.documentElement.style.fontSize = percent === 100 ? "" : `${percent}%`;
  try {
    if (percent === 100) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(percent));
  } catch {
    // storage unavailable: the size holds until the page is reloaded
  }
}

// Runs before the first paint (root layout), so a scaled device never flashes
// at full size. The public bakery site is never scaled.
export const UI_SCALE_BOOT_SCRIPT = `try{var s=Number(localStorage.getItem("${KEY}"));if(s&&s!==100&&location.pathname.indexOf("/ar-amir")!==0&&location.pathname.indexOf("/app")!==0)document.documentElement.style.fontSize=s+"%"}catch(e){}`;
