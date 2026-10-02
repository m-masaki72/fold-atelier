import * as THREE from 'three';

const EPS = 1e-7;
const UP = new THREE.Vector3(0, 1, 0);
const pointKey = (point) =>
  point
    .toArray()
    .map((value) => Math.round(value / EPS))
    .join(',');

function faceCoordinates(points, normal) {
  const center = points
    .reduce((sum, point) => sum.add(point), new THREE.Vector3())
    .divideScalar(points.length);
  const x =
    Math.abs(normal.y) > 0.99
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3().crossVectors(UP, normal).normalize();
  const y = new THREE.Vector3().crossVectors(normal, x);
  return { center, x, y, frame: new THREE.Matrix4().makeBasis(x, y, normal).setPosition(center) };
}

export function convexFaces(vertices) {
  const faces = new Map();
  for (let i = 0; i < vertices.length; i++)
    for (let j = i + 1; j < vertices.length; j++)
      for (let k = j + 1; k < vertices.length; k++) {
        const normal = new THREE.Vector3().crossVectors(
          vertices[j].clone().sub(vertices[i]),
          vertices[k].clone().sub(vertices[i]),
        );
        if (normal.lengthSq() < 1e-12) continue;
        normal.normalize();
        const distances = vertices.map((vertex) => vertex.clone().sub(vertices[i]).dot(normal));
        if (distances.some((distance) => distance > EPS) && distances.some((distance) => distance < -EPS))
          continue;
        if (distances.some((distance) => distance > EPS)) normal.negate();
        const ids = distances.flatMap((distance, index) => (Math.abs(distance) < EPS ? [index] : []));
        const key = ids.join(',');
        if (faces.has(key)) continue;
        const { center, x, y, frame } = faceCoordinates(
          ids.map((id) => vertices[id]),
          normal,
        );
        ids.sort((a, b) => {
          const offsetA = vertices[a].clone().sub(center);
          const offsetB = vertices[b].clone().sub(center);
          return Math.atan2(offsetA.dot(y), offsetA.dot(x)) - Math.atan2(offsetB.dot(y), offsetB.dot(x));
        });
        const inverse = frame.clone().invert();
        faces.set(key, {
          ids,
          normal,
          frame,
          corners: ids.map((id) => vertices[id].clone().applyMatrix4(inverse).setZ(0)),
        });
      }
  return [...faces.values()];
}

function cleanPolygon(points) {
  const distinct = points.filter(
    (point, index) => point.distanceTo(points[(index + 1) % points.length]) > EPS,
  );
  return distinct.length >= 3 ? distinct : [];
}

function splitPolygon(points, plane) {
  const inside = [],
    outside = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const distanceA = plane.distanceToPoint(a),
      distanceB = plane.distanceToPoint(b);
    if (distanceA <= EPS) inside.push(a);
    if (distanceA >= -EPS) outside.push(a);
    if ((distanceA > EPS && distanceB < -EPS) || (distanceA < -EPS && distanceB > EPS)) {
      const intersection = a.clone().lerp(b, distanceA / (distanceA - distanceB));
      inside.push(intersection);
      outside.push(intersection);
    }
  }
  return [cleanPolygon(inside), cleanPolygon(outside)];
}

function subtractSolid(polygon, planes) {
  if (
    planes.some(
      (plane) =>
        polygon.every((point) => plane.distanceToPoint(point) >= -EPS) &&
        polygon.some((point) => plane.distanceToPoint(point) > EPS),
    )
  )
    return [polygon];
  let remaining = polygon;
  const outside = [];
  for (const plane of planes) {
    if (!remaining.length) break;
    const distances = remaining.map((point) => plane.distanceToPoint(point));
    if (Math.min(...distances) >= -EPS && Math.max(...distances) > EPS) {
      outside.push(remaining);
      break;
    }
    if (Math.max(...distances) <= EPS) continue;
    const [inner, outer] = splitPolygon(remaining, plane);
    if (outer.length) outside.push(outer);
    remaining = inner;
  }
  return outside;
}

function exteriorPolygons(solids) {
  const polygons = [];
  solids.forEach((solid, solidIndex) => {
    solid.faces.forEach((face) => {
      const original = face.ids.map((id) => solid.vertices[id]);
      let pieces = [original];
      solids.forEach((other, otherIndex) => {
        if (otherIndex === solidIndex) return;
        // A coincident face facing the same way belongs to just one solid.
        const coincident = other.planes.find((plane) =>
          original.every((point) => Math.abs(plane.distanceToPoint(point)) < EPS),
        );
        if (coincident && coincident.normal.dot(face.normal) > 0.99 && otherIndex < solidIndex) return;
        pieces = pieces.flatMap((piece) => subtractSolid(piece, other.planes));
      });
      const paintFrame = face.frame.clone().invert();
      const paintBounds = new THREE.Box3().setFromPoints(
        original.map((point) => point.clone().applyMatrix4(paintFrame)),
      );
      for (const points of pieces)
        polygons.push({
          points,
          normal: face.normal,
          color: solid.pattern === 'face' && face.normal.y > 0.9 ? '#625345' : solid.color,
          pattern: face.normal.z > 0.9 ? solid.pattern : undefined,
          name: solid.name,
          paintFrame,
          paintBounds,
        });
    });
  });
  return polygons;
}

// Canonical vertices and edge subdivisions remove T-junctions created by clipping.
function connectPolygons(polygons) {
  const vertices = [],
    ids = new Map();
  for (const polygon of polygons)
    for (const point of polygon.points) {
      const key = pointKey(point);
      if (!ids.has(key)) {
        ids.set(key, vertices.length);
        vertices.push(point);
      }
    }
  const faces = polygons.map((polygon) => {
    const faceIds = [];
    polygon.points.forEach((a, index) => {
      const b = polygon.points[(index + 1) % polygon.points.length];
      const edge = b.clone().sub(a),
        lengthSquared = edge.lengthSq();
      const onEdge = vertices.flatMap((point, id) => {
        const t = point.clone().sub(a).dot(edge) / lengthSquared;
        return t >= -EPS && t < 1 - EPS && a.clone().addScaledVector(edge, t).distanceTo(point) < EPS
          ? [{ id, t }]
          : [];
      });
      onEdge.sort((a, b) => a.t - b.t);
      faceIds.push(...onEdge.map((point) => point.id));
    });
    const { frame } = faceCoordinates(polygon.points, polygon.normal);
    const inverse = frame.clone().invert();
    return {
      ...polygon,
      ids: faceIds,
      frame,
      normal: polygon.normal,
      corners: faceIds.map((id) => vertices[id].clone().applyMatrix4(inverse).setZ(0)),
      paintUVs: faceIds.map((id) => {
        const point = vertices[id].clone().applyMatrix4(polygon.paintFrame);
        const { min, max } = polygon.paintBounds;
        return [(point.x - min.x) / (max.x - min.x), (point.y - min.y) / (max.y - min.y)];
      }),
    };
  });
  return { vertices, faces };
}

// Subtract convex volumes from each surface polygon. Only exterior polygons
// survive; no hidden caps remain at the joins between the original solids.
export function exteriorSurface(parts, extractFaces = convexFaces) {
  const solids = parts.map((part) => {
    const position = new THREE.Vector3(...part.position);
    const vertices = part.vertices.map((point) => new THREE.Vector3(...point).add(position));
    const faces = extractFaces(vertices);
    return {
      ...part,
      vertices,
      faces,
      planes: faces.map((face) => new THREE.Plane(face.normal, -face.normal.dot(vertices[face.ids[0]]))),
    };
  });
  return connectPolygons(exteriorPolygons(solids));
}
