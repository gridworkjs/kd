<p align="center">
  <img src="logo.svg" width="256" height="256" alt="@gridworkjs/kd">
</p>

<h1 align="center">@gridworkjs/kd</h1>

<p align="center">KD-tree spatial index for static point sets and nearest-neighbor queries</p>

## Install

```
npm install @gridworkjs/kd
```

## Usage

```js
import { createKdTree } from '@gridworkjs/kd'
import { point, bounds } from '@gridworkjs/core'

// index a set of restaurants by location
const tree = createKdTree(r => bounds(r.location))

tree.load([
  { name: 'Corner Bistro', location: point(40.738, -74.005) },
  { name: 'Katz Deli', location: point(40.722, -73.987) },
  { name: 'Joe Pizza', location: point(40.730, -73.989) },
  { name: 'Russ & Daughters', location: point(40.722, -73.988) }
])

// find the 2 closest restaurants to your current location
tree.nearest({ x: 40.725, y: -73.990 }, 2)
// => [{ name: 'Joe Pizza', ... }, { name: 'Katz Deli', ... }]

// search a bounding box
tree.search({ minX: 40.720, minY: -73.990, maxX: 40.730, maxY: -73.985 })
// => [{ name: 'Katz Deli', ... }, { name: 'Russ & Daughters', ... }]
```

## When to Use a KD-tree

KD-trees excel at nearest-neighbor queries on point data. If you have a static dataset and your primary query is "find the k closest items to this point", a KD-tree will outperform other spatial indexes.

Use `load()` to build the tree from a complete dataset - this produces a balanced tree with optimal query performance. Dynamic `insert()` and `remove()` are supported but may unbalance the tree over time.

If your data changes frequently, consider `@gridworkjs/quadtree` (dynamic, sparse data) or `@gridworkjs/hashgrid` (uniform distributions). If your items are rectangles rather than points, `@gridworkjs/rtree` is a better fit.

## API

### `createKdTree(accessor)`

Creates a new KD-tree. The `accessor` function maps each item to its bounding box (`{ minX, minY, maxX, maxY }`). Use `bounds()` from `@gridworkjs/core` to convert geometries.

Returns a spatial index implementing the gridwork protocol.

### `tree.load(items)`

Builds a balanced tree from an array of items, replacing any existing data. This is the preferred way to populate the tree - it produces optimal structure for queries.

### `tree.insert(item)`

Adds a single item to the tree. For bulk data, prefer `load()`.

### `tree.remove(item)`

Removes an item by identity (`===`). Returns `true` if found and removed.

### `tree.search(query)`

Returns all items whose bounds intersect the query. Accepts bounds objects or geometry objects (point, rect, circle).

### `tree.nearest(point, k?)`

Returns the `k` nearest items to the given point, sorted by distance. Defaults to `k=1`. Accepts `{ x, y }` or a point geometry.

### `tree.clear()`

Removes all items from the tree.

### `tree.size`

Number of items in the tree.

### `tree.bounds`

Bounding box of all items, or `null` if empty.

### `tree.accessor`

The bounds accessor function passed at construction.

## License

MIT
