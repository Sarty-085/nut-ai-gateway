import { beforeEach, describe, expect, it } from 'vitest'
import { migrate, type DbAdapter } from '@nutai/db-adapter'
import { openMemoryDb } from '@nutai/db-adapter/node'

describe('Saved Meals workflow', () => {
  let db: DbAdapter
  const NOW = 1_754_100_000_000

  beforeEach(async () => {
    db = openMemoryDb()
    await db.exec('PRAGMA foreign_keys = ON;')
    await migrate(db, NOW)
  })

  it('can save a meal with ingredients to saved_meals and reload it', async () => {
    // Seed meal and items
    await db.run(
      `INSERT INTO meals (id, logged_at, local_date, meal_slot, portion_eaten_fraction, analysis_status, created_at)
       VALUES (1, ?, '2026-08-26', 'lunch', 1.0, 'complete', ?)`,
      [NOW, NOW],
    )
    await db.run(
      `INSERT INTO log_items (meal_id, matched_food_source, display_name, grams, gram_pathway, portion_source,
                              snap_energy_kcal, snap_protein_g, snap_fat_g, snap_carb_g, is_estimate, macros_user_edited,
                              sort_order, logged_at)
       VALUES (1, 'corpus', 'Paneer Tikka', 200, 'manual', 'database', 260, 18, 20, 6, 0, 0, 0, ?)`,
      [NOW],
    )

    // Read items and insert to saved_meals
    const items = await db.all('SELECT * FROM log_items WHERE meal_id = 1')
    expect(items.length).toBe(1)

    const res = await db.run(
      'INSERT INTO saved_meals (name, items_json, use_count, last_used_at, created_at) VALUES (?,?,?,?,?)',
      ['My Paneer Lunch', JSON.stringify(items), 1, NOW, NOW],
    )
    const savedId = Number(res.lastInsertRowId)
    expect(savedId).toBeGreaterThan(0)

    const saved = await db.get<{ id: number; name: string; items_json: string }>(
      'SELECT id, name, items_json FROM saved_meals WHERE id = ?',
      [savedId],
    )
    expect(saved?.name).toBe('My Paneer Lunch')
    const parsed = JSON.parse(saved!.items_json)
    expect(parsed[0].display_name).toBe('Paneer Tikka')

    // Delete saved meal
    await db.run('DELETE FROM saved_meals WHERE id = ?', [savedId])
    const afterDelete = await db.get('SELECT * FROM saved_meals WHERE id = ?', [savedId])
    expect(afterDelete).toBeNull()
  })
})
