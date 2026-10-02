import * as THREE from 'three';

const EPS = 1e-7;
const pointKey = (p) =>
  p
    .toArray()
    .map((n) => Math.round(n / EPS))
    .join(',');

function clean(points) {
  points = points.filter((p, i) => p.distanceTo(points[(i + 1) % points.length]) > EPS);
  return points.length >= 3 ? points : [];
}

function split(points, plane) {
  const inside = [],
    outside = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const da = plane.normal.dot(a) - plane.distance,
      db = plane.normal.dot(b) - plane.distance;
    if (da <= EPS) inside.push(a);
    if (da >= -EPS) outside.push(a);
    if ((da > EPS && db < -EPS) || (da < -EPS && db > EPS)) {
      const intersection = a.clone().lerp(b, da / (da - db));
      inside.push(intersection);
      outside.push(intersection);
    }
  }
  return [clean(inside), clean(outside)];
}

// Subtract convex volumes from each surface polygon. Only exterior polygons
// survive; no hidden caps remain at the joins between the original solids.
export function exteriorSurface(parts, convexFaces) {
  const solids = parts.map((part) => {
    const vertices = part.vertices.map((p) =>
      new THREE.Vector3(...p).add(new THREE.Vector3(...part.position)),
    );
    const faces = convexFaces(vertices);
    return {
      ...part,
      vertices,
      faces,
      planes: faces.map((f) => ({ normal: f.normal, distance: f.normal.dot(vertices[f.ids[0]]) })),
    };
  });
  const polygons = [];
  solids.forEach((solid, s) => {
    solid.faces.forEach((face) => {
      const original = face.ids.map((i) => solid.vertices[i]);
      let pieces = [original];
      solids.forEach((other, o) => {
        if (o === s) return;
        // A coincident face facing the same way belongs to just one solid.
        const coincident = other.planes.find((plane) =>
          original.every((p) => Math.abs(plane.normal.dot(p) - plane.distance) < EPS),
        );
        if (coincident && coincident.normal.dot(face.normal) > 0.99 && o < s) return;
        pieces = pieces.flatMap((piece) => {
          if (
            other.planes.some(
              (plane) =>
                piece.every((p) => plane.normal.dot(p) - plane.distance >= -EPS) &&
                piece.some((p) => plane.normal.dot(p) - plane.distance > EPS),
            )
          )
            return [piece];
          let remaining = piece;
          const outside = [];
          for (const plane of other.planes) {
            if (!remaining.length) break;
            const distances = remaining.map((p) => plane.normal.dot(p) - plane.distance);
            if (Math.min(...distances) >= -EPS && Math.max(...distances) > EPS) {
              outside.push(remaining);
              remaining = [];
              break;
            }
            if (Math.max(...distances) <= EPS) continue;
            const [inner, outer] = split(remaining, plane);
            if (outer.length) outside.push(outer);
            remaining = inner;
          }
          return outside;
        });
      });
      const inverse = face.frame.clone().invert();
      const bounds = new THREE.Box3().setFromPoints(original.map((p) => p.clone().applyMatrix4(inverse)));
      for (const points of pieces)
        polygons.push({
          points,
          normal: face.normal,
          color: solid.pattern === 'face' && face.normal.y > 0.9 ? '#625345' : solid.color,
          pattern: face.normal.z > 0.9 ? solid.pattern : undefined,
          name: solid.name,
          paintFrame: inverse,
          paintBounds: bounds,
        });
    });
  });
  // Canonical vertices and edge subdivisions remove T-junctions created by clipping.
  const vertices = [],
    ids = new Map();
  for (const polygon of polygons)
    for (const p of polygon.points) {
      const key = pointKey(p);
      if (!ids.has(key)) {
        ids.set(key, vertices.length);
        vertices.push(p);
      }
    }
  const faces = polygons.map((polygon) => {
    const faceIds = [];
    polygon.points.forEach((a, i) => {
      const b = polygon.points[(i + 1) % polygon.points.length],
        edge = b.clone().sub(a),
        lengthSq = edge.lengthSq();
      const onEdge = vertices.flatMap((p, id) => {
        const t = p.clone().sub(a).dot(edge) / lengthSq;
        return t >= -EPS && t < 1 - EPS && a.clone().addScaledVector(edge, t).distanceTo(p) < EPS
          ? [{ id, t }]
          : [];
      });
      onEdge.sort((x, y) => x.t - y.t);
      faceIds.push(...onEdge.map((p) => p.id));
    });
    const center = polygon.points
      .reduce((a, p) => a.add(p), new THREE.Vector3())
      .divideScalar(polygon.points.length);
    const normal = polygon.normal;
    const x =
      Math.abs(normal.y) > 0.99
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), normal).normalize();
    const y = new THREE.Vector3().crossVectors(normal, x);
    const frame = new THREE.Matrix4().makeBasis(x, y, normal).setPosition(center),
      inverse = frame.clone().invert();
    return {
      ...polygon,
      ids: faceIds,
      frame,
      normal,
      corners: faceIds.map((id) => vertices[id].clone().applyMatrix4(inverse).setZ(0)),
      paintUVs: faceIds.map((id) => {
        const p = vertices[id].clone().applyMatrix4(polygon.paintFrame),
          { min, max } = polygon.paintBounds;
        return [(p.x - min.x) / (max.x - min.x), (p.y - min.y) / (max.y - min.y)];
      }),
    };
  });
  return { vertices, faces };
}
