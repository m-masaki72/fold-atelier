import * as THREE from 'three';

export function createPaperSurface(color, pattern) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.94 });
  if (!pattern) return material;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 128, 128);
  const rect = (x, y, w, h, fill) => {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  };
  const dark = '#34464a',
    light = '#f1e7cf';
  const window = (x, y, w, h) => {
    rect(x - 3, y - 3, w + 6, h + 6, light);
    rect(x, y, w, h, '#668f9b');
    rect(x + w / 2 - 1, y, 2, h, light);
    rect(x, y + h / 2 - 1, w, 2, light);
  };
  switch (pattern) {
    case 'face':
      rect(0, 0, 128, 27, '#625345');
      rect(0, 25, 18, 27, '#625345');
      rect(111, 25, 17, 20, '#625345');
      rect(25, 52, 23, 13, light);
      rect(80, 52, 23, 13, light);
      rect(35, 52, 10, 13, dark);
      rect(80, 52, 10, 13, dark);
      rect(57, 68, 15, 14, '#b88362');
      rect(45, 93, 38, 7, '#755647');
      break;
    case 'robot-face':
      rect(13, 30, 102, 45, dark);
      rect(27, 42, 22, 19, '#c0dcc1');
      rect(79, 42, 22, 19, '#c0dcc1');
      rect(39, 93, 50, 12, dark);
      for (let x = 44; x < 89; x += 10) rect(x, 95, 3, 8, light);
      break;
    case 'shirt':
      rect(42, 0, 44, 14, '#d8ae82');
      rect(52, 12, 24, 10, '#d8ae82');
      rect(18, 44, 26, 25, '#ffffff24');
      rect(0, 113, 128, 15, '#334852');
      rect(56, 113, 16, 10, '#cfb87d');
      break;
    case 'robot-chest':
      rect(24, 24, 80, 75, dark);
      rect(34, 34, 60, 35, '#829c99');
      rect(35, 80, 12, 9, '#dcb764');
      rect(57, 80, 12, 9, '#b85d44');
      rect(79, 80, 12, 9, '#afc4ae');
      break;
    case 'boots':
      rect(0, 106, 128, 22, dark);
      break;
    case 'cat-face':
      rect(20, 36, 24, 25, '#e5d895');
      rect(84, 36, 24, 25, '#e5d895');
      rect(32, 36, 7, 25, dark);
      rect(89, 36, 7, 25, dark);
      rect(55, 69, 18, 11, '#a96f69');
      rect(62, 80, 4, 13, dark);
      rect(45, 91, 19, 3, dark);
      rect(64, 91, 19, 3, dark);
      rect(8, 74, 31, 3, light);
      rect(89, 74, 31, 3, light);
      rect(6, 85, 31, 3, light);
      rect(91, 85, 31, 3, light);
      break;
    case 'house':
      rect(0, 111, 128, 17, '#ac9e86');
      window(15, 30, 29, 33);
      window(84, 30, 29, 33);
      rect(51, 68, 27, 60, '#816b52');
      rect(70, 97, 4, 4, '#e0be6a');
      break;
    case 'rocket-window':
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(64, 40, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#769eac';
      ctx.beginPath();
      ctx.arc(64, 40, 20, 0, Math.PI * 2);
      ctx.fill();
      rect(52, 28, 7, 15, '#e4eedf');
      rect(0, 99, 128, 13, '#a35d4c');
      break;
    case 'castle-door':
      rect(40, 54, 48, 74, '#6b6a62');
      rect(48, 61, 32, 67, '#837761');
      for (let x = 50; x < 81; x += 8) rect(x, 61, 2, 67, '#4b514b');
      break;
    case 'tower':
      window(48, 24, 31, 32);
      window(48, 82, 31, 32);
      break;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.channel = 1;
  material.map = texture;
  material.color.set('#ffffff');
  return material;
}

export function createGroundShadow() {
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const shadowContext = shadowCanvas.getContext('2d');
  const gradient = shadowContext.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.35, '#ffffff88');
  gradient.addColorStop(1, '#ffffff00');
  shadowContext.fillStyle = gradient;
  shadowContext.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: '#516259',
      map: new THREE.CanvasTexture(shadowCanvas),
      transparent: true,
      opacity: 0.085,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  return shadow;
}
