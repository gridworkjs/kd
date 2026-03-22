import {
  SPATIAL_INDEX, bounds as toBounds,
  intersects, distanceToPoint
} from '@gridworkjs/core'

/**
 * @typedef {{ minX: number, minY: number, maxX: number, maxY: number }} Bounds
 * @typedef {{ x: number, y: number }} Point
 * @typedef {(item: T) => Bounds} Accessor
 * @template T
 */

function validateAccessorBounds(b) {
  if (b === null || typeof b !== 'object') {
    throw new Error('accessor must return a bounds object')
  }
  if (!Number.isFinite(b.minX) || !Number.isFinite(b.minY) ||
      !Number.isFinite(b.maxX) || !Number.isFinite(b.maxY)) {
    throw new Error('accessor returned non-finite bounds')
  }
  if (b.minX > b.maxX || b.minY > b.maxY) {
    throw new Error('accessor returned inverted bounds (minX > maxX or minY > maxY)')
  }
}

function normalizeBounds(input) {
  if (input != null && typeof input === 'object' &&
      'minX' in input && 'minY' in input && 'maxX' in input && 'maxY' in input) {
    return input
  }
  return toBounds(input)
}

function centerDim(b, dim) {
  return dim === 0 ? (b.minX + b.maxX) / 2 : (b.minY + b.maxY) / 2
}

function makeNode(entry, depth) {
  const dim = depth % 2
  return {
    entry,
    splitDim: dim,
    splitVal: centerDim(entry.bounds, dim),
    subtreeBounds: { ...entry.bounds },
    left: null,
    right: null
  }
}

function expandBounds(target, source) {
  if (source.minX < target.minX) target.minX = source.minX
  if (source.minY < target.minY) target.minY = source.minY
  if (source.maxX > target.maxX) target.maxX = source.maxX
  if (source.maxY > target.maxY) target.maxY = source.maxY
}

function recomputeSubtreeBounds(node) {
  node.subtreeBounds = { ...node.entry.bounds }
  if (node.left) expandBounds(node.subtreeBounds, node.left.subtreeBounds)
  if (node.right) expandBounds(node.subtreeBounds, node.right.subtreeBounds)
}

function buildSubtree(entries, depth) {
  if (entries.length === 0) return null
  if (entries.length === 1) return makeNode(entries[0], depth)

  const dim = depth % 2
  entries.sort((a, b) => centerDim(a.bounds, dim) - centerDim(b.bounds, dim))
  const mid = entries.length >> 1

  const node = makeNode(entries[mid], depth)
  node.left = buildSubtree(entries.slice(0, mid), depth + 1)
  node.right = buildSubtree(entries.slice(mid + 1), depth + 1)
  recomputeSubtreeBounds(node)
  return node
}

function insertInto(node, entry, depth) {
  if (!node) return makeNode(entry, depth)

  const val = centerDim(entry.bounds, node.splitDim)
  if (val < node.splitVal) {
    node.left = insertInto(node.left, entry, depth + 1)
  } else {
    node.right = insertInto(node.right, entry, depth + 1)
  }

  expandBounds(node.subtreeBounds, entry.bounds)
  return node
}

function findMin(node, targetDim, depth) {
  if (!node) return null
  const dim = depth % 2

  if (dim === targetDim) {
    if (!node.left) return node.entry
    return findMin(node.left, targetDim, depth + 1)
  }

  const leftMin = findMin(node.left, targetDim, depth + 1)
  const rightMin = findMin(node.right, targetDim, depth + 1)

  let best = node.entry
  if (leftMin && centerDim(leftMin.bounds, targetDim) < centerDim(best.bounds, targetDim)) {
    best = leftMin
  }
  if (rightMin && centerDim(rightMin.bounds, targetDim) < centerDim(best.bounds, targetDim)) {
    best = rightMin
  }
  return best
}

function removeFrom(node, item, itemBounds, depth) {
  if (!node) return { node: null, found: false }

  if (node.entry.item === item) {
    if (!node.left && !node.right) return { node: null, found: true }

    const dim = node.splitDim
    if (node.right) {
      const rep = findMin(node.right, dim, depth + 1)
      node.entry = rep
      node.splitVal = centerDim(rep.bounds, dim)
      const r = removeFrom(node.right, rep.item, rep.bounds, depth + 1)
      node.right = r.node
    } else {
      const rep = findMin(node.left, dim, depth + 1)
      node.entry = rep
      node.splitVal = centerDim(rep.bounds, dim)
      const r = removeFrom(node.left, rep.item, rep.bounds, depth + 1)
      node.right = r.node
      node.left = null
    }
    recomputeSubtreeBounds(node)
    return { node, found: true }
  }

  const val = centerDim(itemBounds, node.splitDim)

  if (val < node.splitVal) {
    const r = removeFrom(node.left, item, itemBounds, depth + 1)
    node.left = r.node
    if (r.found) recomputeSubtreeBounds(node)
    return { node, found: r.found }
  }

  if (val > node.splitVal) {
    const r = removeFrom(node.right, item, itemBounds, depth + 1)
    node.right = r.node
    if (r.found) recomputeSubtreeBounds(node)
    return { node, found: r.found }
  }

  // val === splitVal, could be on either side due to bulk build ordering
  const r = removeFrom(node.right, item, itemBounds, depth + 1)
  node.right = r.node
  if (r.found) {
    recomputeSubtreeBounds(node)
    return { node, found: true }
  }

  const l = removeFrom(node.left, item, itemBounds, depth + 1)
  node.left = l.node
  if (l.found) recomputeSubtreeBounds(node)
  return { node, found: l.found }
}

function searchTree(node, queryBounds, results) {
  if (!node) return
  if (!intersects(node.subtreeBounds, queryBounds)) return

  if (intersects(node.entry.bounds, queryBounds)) {
    results.push(node.entry.item)
  }

  searchTree(node.left, queryBounds, results)
  searchTree(node.right, queryBounds, results)
}

// max-heap for knn (tracks the worst of the k best candidates)
function maxHeapPush(heap, entry) {
  heap.push(entry)
  let i = heap.length - 1
  while (i > 0) {
    const p = (i - 1) >> 1
    if (heap[p].dist >= heap[i].dist) break
    ;[heap[p], heap[i]] = [heap[i], heap[p]]
    i = p
  }
}

function maxHeapPop(heap) {
  const top = heap[0]
  const last = heap.pop()
  if (heap.length > 0) {
    heap[0] = last
    let i = 0
    for (;;) {
      let s = i
      const l = 2 * i + 1
      const r = 2 * i + 2
      if (l < heap.length && heap[l].dist > heap[s].dist) s = l
      if (r < heap.length && heap[r].dist > heap[s].dist) s = r
      if (s === i) break
      ;[heap[i], heap[s]] = [heap[s], heap[i]]
      i = s
    }
  }
  return top
}

function nearestSearch(node, px, py, heap, k) {
  if (!node) return

  const subtreeDist = distanceToPoint(node.subtreeBounds, px, py)
  if (heap.length >= k && subtreeDist >= heap[0].dist) return

  const dist = distanceToPoint(node.entry.bounds, px, py)
  if (heap.length < k) {
    maxHeapPush(heap, { dist, item: node.entry.item })
  } else if (dist < heap[0].dist) {
    maxHeapPop(heap)
    maxHeapPush(heap, { dist, item: node.entry.item })
  }

  const val = node.splitDim === 0 ? px : py
  const near = val < node.splitVal ? node.left : node.right
  const far = val < node.splitVal ? node.right : node.left

  nearestSearch(near, px, py, heap, k)
  nearestSearch(far, px, py, heap, k)
}

function computeBounds(node) {
  if (!node) return null
  return { ...node.subtreeBounds }
}

/**
 * Creates a KD-tree spatial index. Optimized for static point sets and nearest-neighbor queries.
 * Supports dynamic inserts and removes, but `load()` produces a balanced tree for best performance.
 *
 * @param {(item: any) => Bounds | object} accessor - Maps items to their bounding boxes or geometries
 * @returns {import('@gridworkjs/core').SpatialIndex & { load: (items: any[]) => void }}
 */
export function createKdTree(accessor) {
  if (typeof accessor !== 'function') {
    throw new Error('accessor must be a function')
  }

  let root = null
  let size = 0
  let totalBounds = null

  const index = {
    [SPATIAL_INDEX]: true,

    get size() { return size },

    get bounds() { return totalBounds },

    insert(item) {
      const raw = accessor(item)
      const itemBounds = normalizeBounds(raw)
      validateAccessorBounds(itemBounds)

      const entry = { item, bounds: itemBounds }
      root = insertInto(root, entry, 0)

      if (totalBounds === null) {
        totalBounds = { ...itemBounds }
      } else {
        expandBounds(totalBounds, itemBounds)
      }

      size++
    },

    load(items) {
      root = null
      size = 0
      totalBounds = null

      if (!items || items.length === 0) return

      const entries = items.map(item => {
        const raw = accessor(item)
        const itemBounds = normalizeBounds(raw)
        validateAccessorBounds(itemBounds)
        return { item, bounds: itemBounds }
      })

      root = buildSubtree(entries, 0)
      size = entries.length
      totalBounds = computeBounds(root)
    },

    remove(item) {
      if (size === 0) return false

      const raw = accessor(item)
      const itemBounds = normalizeBounds(raw)

      const result = removeFrom(root, item, itemBounds, 0)
      root = result.node

      if (result.found) {
        size--
        totalBounds = computeBounds(root)
      }

      return result.found
    },

    search(query) {
      if (size === 0) return []
      const queryBounds = normalizeBounds(query)
      const results = []
      searchTree(root, queryBounds, results)
      return results
    },

    nearest(queryPoint, k = 1) {
      if (size === 0 || k <= 0) return []

      const px = queryPoint.x
      const py = queryPoint.y

      const heap = []
      nearestSearch(root, px, py, heap, k)

      const results = []
      while (heap.length > 0) {
        results.push(maxHeapPop(heap).item)
      }
      results.reverse()
      return results
    },

    clear() {
      root = null
      size = 0
      totalBounds = null
    }
  }

  return index
}
