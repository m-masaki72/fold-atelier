import * as THREE from 'three';

export function decoratePaperMaterial(material) {
  material.polygonOffset = true;
  material.polygonOffsetFactor = 0;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float foldHighlight;\nvarying float vFoldHighlight;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFoldHighlight = foldHighlight;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFoldHighlight;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.41, 0.07), vFoldHighlight);',
      );
  };
  material.customProgramCacheKey = () => 'fold-paper-highlight-v1';
  return material;
}

export function paperDepthUnits(faceIndex) {
  return (faceIndex + 1) * 4;
}

// Coplanar transparent faces must share one sort depth. Sorting their separate
// centroids can otherwise reverse the blended colors when the camera rotates.
export function paperSortCenters(faces, matrices, thickness = 0.012) {
  const groups = new Map();
  const centers = faces.map((face, index) =>
    [0, -thickness].map((offset) => {
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrices[index]);
      const center = face.corners
        .reduce((sum, p) => sum.add(new THREE.Vector3(...p)), new THREE.Vector3())
        .divideScalar(face.corners.length);
      center.z += offset;
      center.applyMatrix4(matrices[index]);
      const first = normal.toArray().find((n) => Math.abs(n) > 1e-6);
      if (first < 0) normal.negate();
      const key = [...normal.toArray(), center.dot(normal)].map((n) => Math.round(n * 1e5)).join(',');
      if (!groups.has(key)) groups.set(key, { sum: new THREE.Vector3(), count: 0 });
      const group = groups.get(key);
      group.sum.add(center);
      group.count++;
      return group;
    }),
  );
  for (const group of groups.values()) group.sum.divideScalar(group.count);
  return centers.map((pair) => pair.map((group) => group.sum));
}

export function stablePaperTransparency(a, b) {
  if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
  if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
  const az = a.object.userData.paperSortDepth ?? a.z;
  const bz = b.object.userData.paperSortDepth ?? b.z;
  return bz - az || a.id - b.id;
}
