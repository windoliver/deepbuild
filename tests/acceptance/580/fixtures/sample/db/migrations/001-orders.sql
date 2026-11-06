CREATE TABLE IF NOT EXISTS orders (id serial PRIMARY KEY, item text NOT NULL);
CREATE TABLE IF NOT EXISTS products (sku text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS padding (id integer, fill text);
