INSERT INTO menu_items (name, description, price_cents, category) VALUES
  ('Honey oat latte', 'espresso · oat milk · local honey', 550, 'drink'),
  ('Cardamom bun', 'laminated dough · orange sugar', 425, 'pastry'),
  ('Citrus tonic', 'espresso · grapefruit · sparkling water', 475, 'drink'),
  ('Maple cortado', 'double espresso · steamed milk · maple', 500, 'drink'),
  ('Rosemary focaccia', 'olive oil · sea salt · fresh rosemary', 525, 'pastry'),
  ('Seasonal fruit bowl', 'citrus · berries · mint', 600, 'food'),
  ('Dark chocolate cookie', 'brown butter · dark chocolate · sea salt', 350, 'pastry'),
  ('Vanilla bean iced tea', 'black tea · vanilla · lemon', 400, 'drink');

INSERT INTO rewards (name, description, credit_cost, menu_item_id) VALUES
  ('Any pastry', 'Choose from today''s pastry case', 80, 2),
  ('House cold brew', 'Slow-steeped for a smooth finish', 120, NULL),
  ('Signature latte', 'Oat milk and a double shot', 180, 1);

INSERT INTO tier_rules (tier, points_per_rupee, minimum_lifetime_points) VALUES
  ('bronze', 1.0, 0),
  ('silver', 1.25, 500),
  ('gold', 1.5, 1500),
  ('platinum', 0.3, 5000);