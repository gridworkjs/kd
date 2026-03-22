import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createKdTree } from '../src/index.js'
import {
  point, rect, circle, bounds,
  SPATIAL_INDEX, isSpatialIndex
} from '@gridworkjs/core'

const accessor = item => bounds(item.geo)

function pts(coords) {
  return coords.map(([x, y], i) => ({ id: i, geo: point(x, y) }))
}

describe('protocol compliance', () => {
  it('has the SPATIAL_INDEX symbol', () => {
    const tree = createKdTree(accessor)
    assert.equal(tree[SPATIAL_INDEX], true)
  })

  it('passes isSpatialIndex', () => {
    const tree = createKdTree(accessor)
    assert.equal(isSpatialIndex(tree), true)
  })

  it('has all required methods', () => {
    const tree = createKdTree(accessor)
    for (const m of ['insert', 'remove', 'search', 'nearest', 'clear']) {
      assert.equal(typeof tree[m], 'function')
    }
  })
})

describe('construction validation', () => {
  it('throws if accessor is not a function', () => {
    assert.throws(() => createKdTree(null), /accessor must be a function/)
  })

  it('throws if accessor is a string', () => {
    assert.throws(() => createKdTree('bad'), /accessor must be a function/)
  })
})

describe('input validation', () => {
  it('throws on NaN bounds from accessor', () => {
    const tree = createKdTree(() => ({ minX: NaN, minY: 0, maxX: 10, maxY: 10 }))
    assert.throws(() => tree.insert({}), /non-finite/)
  })

  it('throws on Infinity bounds from accessor', () => {
    const tree = createKdTree(() => ({ minX: 0, minY: 0, maxX: Infinity, maxY: 10 }))
    assert.throws(() => tree.insert({}), /non-finite/)
  })

  it('throws on inverted bounds from accessor', () => {
    const tree = createKdTree(() => ({ minX: 10, minY: 0, maxX: 5, maxY: 10 }))
    assert.throws(() => tree.insert({}), /inverted/)
  })

  it('validates bounds during load', () => {
    const tree = createKdTree(() => ({ minX: NaN, minY: 0, maxX: 10, maxY: 10 }))
    assert.throws(() => tree.load([{}]), /non-finite/)
  })

  it('preserves existing data when load validation fails', () => {
    let shouldFail = false
    const tree = createKdTree(item => {
      if (shouldFail && item.bad) return { minX: NaN, minY: 0, maxX: 10, maxY: 10 }
      return bounds(item.geo)
    })
    tree.load(pts([[10, 20], [30, 40]]))
    assert.equal(tree.size, 2)

    shouldFail = true
    const bad = [{ geo: point(50, 60) }, { geo: point(70, 80), bad: true }]
    assert.throws(() => tree.load(bad), /non-finite/)
    assert.equal(tree.size, 2)
  })
})

describe('insert and size', () => {
  it('starts empty', () => {
    const tree = createKdTree(accessor)
    assert.equal(tree.size, 0)
  })

  it('tracks size after inserts', () => {
    const tree = createKdTree(accessor)
    const items = pts([[10, 20], [30, 40], [50, 60]])
    for (const item of items) tree.insert(item)
    assert.equal(tree.size, 3)
  })

  it('handles duplicate inserts as separate entries', () => {
    const tree = createKdTree(accessor)
    const item = { id: 0, geo: point(5, 5) }
    tree.insert(item)
    tree.insert(item)
    assert.equal(tree.size, 2)
  })
})

describe('load', () => {
  it('builds a balanced tree from items', () => {
    const tree = createKdTree(accessor)
    const items = pts([[10, 10], [50, 50], [90, 90], [30, 30], [70, 70]])
    tree.load(items)
    assert.equal(tree.size, 5)
  })

  it('clears existing data on load', () => {
    const tree = createKdTree(accessor)
    tree.insert({ id: 0, geo: point(1, 1) })
    tree.load(pts([[10, 10], [20, 20]]))
    assert.equal(tree.size, 2)
  })

  it('handles empty load', () => {
    const tree = createKdTree(accessor)
    tree.insert({ id: 0, geo: point(1, 1) })
    tree.load([])
    assert.equal(tree.size, 0)
    assert.equal(tree.bounds, null)
  })

  it('handles single item load', () => {
    const tree = createKdTree(accessor)
    tree.load(pts([[5, 5]]))
    assert.equal(tree.size, 1)
    const found = tree.search({ minX: 0, minY: 0, maxX: 10, maxY: 10 })
    assert.equal(found.length, 1)
  })

  it('produces correct search results', () => {
    const tree = createKdTree(accessor)
    const items = pts([[10, 10], [50, 50], [90, 90]])
    tree.load(items)

    const found = tree.search({ minX: 0, minY: 0, maxX: 60, maxY: 60 })
    const ids = found.map(i => i.id).sort()
    assert.deepEqual(ids, [0, 1])
  })
})

describe('search', () => {
  it('returns empty for empty tree', () => {
    const tree = createKdTree(accessor)
    assert.deepEqual(tree.search({ minX: 0, minY: 0, maxX: 100, maxY: 100 }), [])
  })

  it('finds items within bounds', () => {
    const tree = createKdTree(accessor)
    const items = pts([[10, 10], [50, 50], [90, 90]])
    for (const item of items) tree.insert(item)

    const found = tree.search({ minX: 0, minY: 0, maxX: 60, maxY: 60 })
    const ids = found.map(i => i.id).sort()
    assert.deepEqual(ids, [0, 1])
  })

  it('finds items on the boundary edge', () => {
    const tree = createKdTree(accessor)
    const item = { id: 0, geo: point(50, 50) }
    tree.insert(item)

    const found = tree.search({ minX: 50, minY: 50, maxX: 100, maxY: 100 })
    assert.equal(found.length, 1)
    assert.equal(found[0].id, 0)
  })

  it('excludes items outside bounds', () => {
    const tree = createKdTree(accessor)
    const items = pts([[10, 10], [200, 200]])
    for (const item of items) tree.insert(item)

    const found = tree.search({ minX: 0, minY: 0, maxX: 50, maxY: 50 })
    assert.equal(found.length, 1)
    assert.equal(found[0].id, 0)
  })

  it('accepts geometry objects as query', () => {
    const tree = createKdTree(accessor)
    const items = pts([[10, 10], [50, 50]])
    for (const item of items) tree.insert(item)

    const found = tree.search(rect(0, 0, 30, 30))
    assert.equal(found.length, 1)
    assert.equal(found[0].id, 0)
  })

  it('accepts circle as query', () => {
    const tree = createKdTree(accessor)
    const items = pts([[10, 10], [200, 200]])
    for (const item of items) tree.insert(item)

    const found = tree.search(circle(10, 10, 5))
    assert.equal(found.length, 1)
  })

  it('searches with point query', () => {
    const tree = createKdTree(accessor)
    const item = { id: 0, geo: point(10, 10) }
    tree.insert(item)

    const found = tree.search(point(10, 10))
    assert.equal(found.length, 1)
  })
})

describe('region items', () => {
  const regionAccessor = item => bounds(item.geo)

  it('indexes rectangles', () => {
    const tree = createKdTree(regionAccessor)
    const r1 = { id: 0, geo: rect(0, 0, 20, 20) }
    const r2 = { id: 1, geo: rect(80, 80, 100, 100) }
    tree.insert(r1)
    tree.insert(r2)

    const found = tree.search({ minX: 10, minY: 10, maxX: 30, maxY: 30 })
    assert.equal(found.length, 1)
    assert.equal(found[0].id, 0)
  })

  it('finds overlapping regions', () => {
    const tree = createKdTree(regionAccessor)
    const r1 = { id: 0, geo: rect(0, 0, 60, 60) }
    const r2 = { id: 1, geo: rect(40, 40, 100, 100) }
    tree.insert(r1)
    tree.insert(r2)

    const found = tree.search({ minX: 45, minY: 45, maxX: 55, maxY: 55 })
    const ids = found.map(i => i.id).sort()
    assert.deepEqual(ids, [0, 1])
  })

  it('finds regions via load', () => {
    const tree = createKdTree(regionAccessor)
    const items = [
      { id: 0, geo: rect(0, 0, 30, 30) },
      { id: 1, geo: rect(50, 50, 80, 80) },
      { id: 2, geo: rect(100, 100, 130, 130) }
    ]
    tree.load(items)

    const found = tree.search({ minX: 20, minY: 20, maxX: 60, maxY: 60 })
    const ids = found.map(i => i.id).sort()
    assert.deepEqual(ids, [0, 1])
  })
})

describe('remove', () => {
  it('returns false for empty tree', () => {
    const tree = createKdTree(accessor)
    assert.equal(tree.remove({ id: 0, geo: point(0, 0) }), false)
  })

  it('removes an item by identity', () => {
    const tree = createKdTree(accessor)
    const item = { id: 0, geo: point(10, 10) }
    tree.insert(item)
    assert.equal(tree.size, 1)

    assert.equal(tree.remove(item), true)
    assert.equal(tree.size, 0)
    assert.deepEqual(tree.search({ minX: 0, minY: 0, maxX: 100, maxY: 100 }), [])
  })

  it('does not remove a different object with same coords', () => {
    const tree = createKdTree(accessor)
    const item = { id: 0, geo: point(10, 10) }
    const clone = { id: 0, geo: point(10, 10) }
    tree.insert(item)

    assert.equal(tree.remove(clone), false)
    assert.equal(tree.size, 1)
  })

  it('removes from a tree with multiple items', () => {
    const tree = createKdTree(accessor)
    const a = { id: 0, geo: point(10, 10) }
    const b = { id: 1, geo: point(50, 50) }
    const c = { id: 2, geo: point(90, 90) }
    tree.insert(a)
    tree.insert(b)
    tree.insert(c)

    assert.equal(tree.remove(b), true)
    assert.equal(tree.size, 2)

    const found = tree.search({ minX: 0, minY: 0, maxX: 100, maxY: 100 })
    const ids = found.map(i => i.id).sort()
    assert.deepEqual(ids, [0, 2])
  })

  it('removes from a bulk-loaded tree', () => {
    const tree = createKdTree(accessor)
    const items = pts([[10, 10], [50, 50], [90, 90], [30, 30], [70, 70]])
    tree.load(items)

    assert.equal(tree.remove(items[2]), true)
    assert.equal(tree.size, 4)

    const found = tree.search({ minX: 80, minY: 80, maxX: 100, maxY: 100 })
    assert.equal(found.length, 0)
  })

  it('updates bounds after remove', () => {
    const tree = createKdTree(accessor)
    const a = { id: 0, geo: point(10, 10) }
    const b = { id: 1, geo: point(100, 100) }
    tree.insert(a)
    tree.insert(b)

    tree.remove(b)
    assert.equal(tree.bounds.maxX, 10)
    assert.equal(tree.bounds.maxY, 10)
  })

  it('handles removing the root node', () => {
    const tree = createKdTree(accessor)
    const items = pts([[50, 50], [20, 20], [80, 80]])
    for (const item of items) tree.insert(item)

    assert.equal(tree.remove(items[0]), true)
    assert.equal(tree.size, 2)

    const found = tree.search({ minX: 0, minY: 0, maxX: 100, maxY: 100 })
    assert.equal(found.length, 2)
  })

  it('handles removing items with duplicate coordinates', () => {
    const tree = createKdTree(accessor)
    const a = { id: 0, geo: point(50, 50) }
    const b = { id: 1, geo: point(50, 50) }
    tree.insert(a)
    tree.insert(b)

    assert.equal(tree.remove(a), true)
    assert.equal(tree.size, 1)

    const found = tree.search({ minX: 0, minY: 0, maxX: 100, maxY: 100 })
    assert.equal(found.length, 1)
    assert.equal(found[0].id, 1)
  })
})

describe('nearest', () => {
  it('returns empty for empty tree', () => {
    const tree = createKdTree(accessor)
    assert.deepEqual(tree.nearest({ x: 0, y: 0 }), [])
  })

  it('finds the single nearest item', () => {
    const tree = createKdTree(accessor)
    const items = pts([[10, 10], [50, 50], [90, 90]])
    for (const item of items) tree.insert(item)

    const result = tree.nearest({ x: 12, y: 12 })
    assert.equal(result.length, 1)
    assert.equal(result[0].id, 0)
  })

  it('finds k nearest items', () => {
    const tree = createKdTree(accessor)
    const items = pts([[0, 0], [10, 10], [20, 20], [100, 100]])
    for (const item of items) tree.insert(item)

    const result = tree.nearest({ x: 5, y: 5 }, 2)
    assert.equal(result.length, 2)
    const ids = result.map(i => i.id).sort()
    assert.deepEqual(ids, [0, 1])
  })

  it('returns all items when k exceeds size', () => {
    const tree = createKdTree(accessor)
    const items = pts([[10, 10], [20, 20]])
    for (const item of items) tree.insert(item)

    const result = tree.nearest({ x: 0, y: 0 }, 10)
    assert.equal(result.length, 2)
  })

  it('handles k=0', () => {
    const tree = createKdTree(accessor)
    tree.insert({ id: 0, geo: point(10, 10) })
    assert.deepEqual(tree.nearest({ x: 0, y: 0 }, 0), [])
  })

  it('accepts point geometry', () => {
    const tree = createKdTree(accessor)
    const items = pts([[10, 10], [50, 50]])
    for (const item of items) tree.insert(item)

    const result = tree.nearest(point(11, 11))
    assert.equal(result.length, 1)
    assert.equal(result[0].id, 0)
  })

  it('returns items in distance order', () => {
    const tree = createKdTree(accessor)
    const items = pts([[100, 100], [10, 10], [50, 50]])
    for (const item of items) tree.insert(item)

    const result = tree.nearest({ x: 0, y: 0 }, 3)
    assert.equal(result[0].id, 1)
    assert.equal(result[1].id, 2)
    assert.equal(result[2].id, 0)
  })

  it('nearest works with bulk-loaded tree', () => {
    const tree = createKdTree(accessor)
    const items = pts([[0, 0], [10, 10], [50, 50], [90, 90], [100, 100]])
    tree.load(items)

    const result = tree.nearest({ x: 8, y: 8 }, 2)
    assert.equal(result.length, 2)
    const ids = result.map(i => i.id).sort()
    assert.deepEqual(ids, [0, 1])
  })
})

describe('clear', () => {
  it('resets the tree', () => {
    const tree = createKdTree(accessor)
    const items = pts([[10, 10], [50, 50]])
    for (const item of items) tree.insert(item)

    tree.clear()
    assert.equal(tree.size, 0)
    assert.deepEqual(tree.search({ minX: 0, minY: 0, maxX: 100, maxY: 100 }), [])
  })

  it('allows inserts after clear', () => {
    const tree = createKdTree(accessor)
    tree.insert({ id: 0, geo: point(10, 10) })
    tree.clear()

    tree.insert({ id: 1, geo: point(20, 20) })
    assert.equal(tree.size, 1)
    const found = tree.search({ minX: 0, minY: 0, maxX: 100, maxY: 100 })
    assert.equal(found[0].id, 1)
  })
})

describe('bounds property', () => {
  it('is null for empty tree', () => {
    const tree = createKdTree(accessor)
    assert.equal(tree.bounds, null)
  })

  it('tracks inserted items', () => {
    const tree = createKdTree(accessor)
    tree.insert({ id: 0, geo: point(10, 20) })
    tree.insert({ id: 1, geo: point(50, 60) })

    assert.equal(tree.bounds.minX, 10)
    assert.equal(tree.bounds.minY, 20)
    assert.equal(tree.bounds.maxX, 50)
    assert.equal(tree.bounds.maxY, 60)
  })

  it('is null after clear', () => {
    const tree = createKdTree(accessor)
    tree.insert({ id: 0, geo: point(10, 10) })
    tree.clear()
    assert.equal(tree.bounds, null)
  })

  it('tracks loaded items', () => {
    const tree = createKdTree(accessor)
    tree.load(pts([[5, 10], [95, 90]]))

    assert.equal(tree.bounds.minX, 5)
    assert.equal(tree.bounds.minY, 10)
    assert.equal(tree.bounds.maxX, 95)
    assert.equal(tree.bounds.maxY, 90)
  })
})

describe('negative coordinates', () => {
  it('handles negative coordinates correctly', () => {
    const tree = createKdTree(accessor)
    const items = pts([[-50, -50], [50, 50]])
    for (const item of items) tree.insert(item)

    const found = tree.search({ minX: -60, minY: -60, maxX: -40, maxY: -40 })
    assert.equal(found.length, 1)
    assert.equal(found[0].id, 0)
  })

  it('nearest works across negative coordinates', () => {
    const tree = createKdTree(accessor)
    const items = pts([[-10, -10], [100, 100]])
    for (const item of items) tree.insert(item)

    const result = tree.nearest({ x: -5, y: -5 })
    assert.equal(result[0].id, 0)
  })
})

describe('collinear points', () => {
  it('handles all points on the same x coordinate', () => {
    const tree = createKdTree(accessor)
    const items = pts([[50, 10], [50, 30], [50, 50], [50, 70], [50, 90]])
    tree.load(items)

    assert.equal(tree.size, 5)
    const found = tree.search({ minX: 40, minY: 25, maxX: 60, maxY: 55 })
    const ids = found.map(i => i.id).sort()
    assert.deepEqual(ids, [1, 2])
  })

  it('handles all points at the same location', () => {
    const tree = createKdTree(accessor)
    const items = pts([[50, 50], [50, 50], [50, 50]])
    tree.load(items)

    assert.equal(tree.size, 3)
    const found = tree.search({ minX: 49, minY: 49, maxX: 51, maxY: 51 })
    assert.equal(found.length, 3)
  })
})

describe('stress', () => {
  it('handles many random points', () => {
    const tree = createKdTree(accessor)

    const items = []
    for (let i = 0; i < 1000; i++) {
      const item = { id: i, geo: point(Math.random() * 1000, Math.random() * 1000) }
      items.push(item)
    }
    tree.load(items)

    assert.equal(tree.size, 1000)

    const found = tree.search({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 })
    assert.equal(found.length, 1000)

    const half = tree.search({ minX: 0, minY: 0, maxX: 500, maxY: 500 })
    assert.ok(half.length > 0)
    assert.ok(half.length < 1000)

    for (const item of half) {
      const b = bounds(item.geo)
      assert.ok(b.minX <= 500 && b.minY <= 500)
    }
  })

  it('nearest returns correct order with many points', () => {
    const tree = createKdTree(accessor)

    const items = []
    for (let i = 0; i < 500; i++) {
      items.push({ id: i, geo: point(Math.random() * 1000, Math.random() * 1000) })
    }
    tree.load(items)

    const result = tree.nearest({ x: 500, y: 500 }, 10)
    assert.equal(result.length, 10)

    for (let i = 1; i < result.length; i++) {
      const prevB = bounds(result[i - 1].geo)
      const currB = bounds(result[i].geo)
      const prevDist = Math.hypot(prevB.minX - 500, prevB.minY - 500)
      const currDist = Math.hypot(currB.minX - 500, currB.minY - 500)
      assert.ok(prevDist <= currDist + 1e-10)
    }
  })

  it('handles interleaved insert and remove', () => {
    const tree = createKdTree(accessor)

    const items = []
    for (let i = 0; i < 200; i++) {
      const item = { id: i, geo: point(Math.random() * 500, Math.random() * 500) }
      items.push(item)
      tree.insert(item)
    }

    for (let i = 0; i < 100; i++) {
      tree.remove(items[i])
    }

    assert.equal(tree.size, 100)

    const found = tree.search({ minX: 0, minY: 0, maxX: 500, maxY: 500 })
    assert.equal(found.length, 100)
  })

  it('dynamic inserts produce correct nearest results', () => {
    const tree = createKdTree(accessor)

    for (let i = 0; i < 100; i++) {
      tree.insert({ id: i, geo: point(i * 10, i * 10) })
    }

    const result = tree.nearest({ x: 505, y: 505 }, 3)
    assert.equal(result.length, 3)
    const ids = result.map(i => i.id).sort((a, b) => a - b)
    assert.deepEqual(ids, [49, 50, 51])
  })
})

describe('accessor property', () => {
  it('exposes the accessor function', () => {
    const fn = item => item.geo
    const tree = createKdTree(fn)
    assert.equal(tree.accessor, fn)
  })
})
