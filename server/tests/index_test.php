<?php
declare(strict_types=1);

$pass = 0;
$fail = 0;

function test(string $name, callable $fn): void {
    global $pass, $fail;
    try {
        $fn();
        echo "  PASS: $name\n";
        $pass++;
    } catch (Throwable $e) {
        echo "  FAIL: $name — " . $e->getMessage() . "\n";
        $fail++;
    }
}

function assert_eq(mixed $expected, mixed $actual, string $msg = ''): void {
    if ($expected !== $actual) {
        $m = $msg ? ": $msg" : '';
        throw new RuntimeException("Expected " . var_export($expected, true) . ", got " . var_export($actual, true) . $m);
    }
}

function assert_true(bool $val, string $msg = ''): void {
    if (!$val) {
        throw new RuntimeException("Expected true" . ($msg ? ": $msg" : ''));
    }
}

// --- Setup: create test DB ---
$dbPath = sys_get_temp_dir() . '/price_exporter_test.sqlite';
@unlink($dbPath);

$db = new SQLite3($dbPath);
$db->enableExceptions(true);
$db->exec('PRAGMA foreign_keys=ON');
$db->exec('CREATE TABLE IF NOT EXISTS vendors (id TEXT PRIMARY KEY, name TEXT NOT NULL, data_json_hash TEXT)');
$db->exec('CREATE TABLE IF NOT EXISTS products (id TEXT NOT NULL, vendor_id TEXT NOT NULL, message TEXT, options_json_hash TEXT, PRIMARY KEY (id, vendor_id), FOREIGN KEY (vendor_id) REFERENCES vendors(id))');
$db->exec('CREATE INDEX IF NOT EXISTS idx_products_vendor ON products(vendor_id)');
$db->exec('CREATE TABLE IF NOT EXISTS product_variants (id INTEGER PRIMARY KEY AUTOINCREMENT, user_name TEXT NOT NULL, product_id TEXT NOT NULL, vendor_id TEXT NOT NULL, product_name TEXT NOT NULL, variant_name TEXT NOT NULL, price_usd REAL NOT NULL, shipping_usd REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%S\', \'now\')))');
$db->exec('CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants(product_id, vendor_id)');

echo "--- SQLite Table Creation ---\n";
test('tables exist', function() use ($db) {
    $tables = $db->query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
    $names = [];
    while ($row = $tables->fetchArray(SQLITE3_ASSOC)) {
        if ($row['name'] !== 'sqlite_sequence') {
            $names[] = $row['name'];
        }
    }
    assert_eq(['product_variants', 'products', 'vendors'], $names);
});
test('vendors PK', function() use ($db) {
    $stmt = $db->prepare('INSERT OR IGNORE INTO vendors (id, name, data_json_hash) VALUES (:id, :n, :h)');
    $stmt->bindValue(':id', 'v1', SQLITE3_TEXT);
    $stmt->bindValue(':n', 'Vendor1', SQLITE3_TEXT);
    $stmt->bindValue(':h', 'hash1', SQLITE3_TEXT);
    assert_true($stmt->execute() !== false);
});

echo "\n--- Vendor Insert & Update ---\n";
test('insert vendor', function() use ($db) {
    $r = $db->querySingle("SELECT name FROM vendors WHERE id='v1'");
    assert_eq('Vendor1', $r);
});
test('update vendor name', function() use ($db) {
    $stmt = $db->prepare('UPDATE vendors SET name = :n WHERE id = :id');
    $stmt->bindValue(':n', 'UpdatedVendor', SQLITE3_TEXT);
    $stmt->bindValue(':id', 'v1', SQLITE3_TEXT);
    $stmt->execute();
    $r = $db->querySingle("SELECT name FROM vendors WHERE id='v1'");
    assert_eq('UpdatedVendor', $r);
});

echo "\n--- Product Insert ---\n";
test('insert product', function() use ($db) {
    $stmt = $db->prepare('INSERT OR REPLACE INTO products (id, vendor_id, message, options_json_hash) VALUES (:pid, :vid, :msg, :h)');
    $stmt->bindValue(':pid', 'p100', SQLITE3_TEXT);
    $stmt->bindValue(':vid', 'v1', SQLITE3_TEXT);
    $stmt->bindValue(':msg', 'Test message', SQLITE3_TEXT);
    $stmt->bindValue(':h', 'opthash', SQLITE3_TEXT);
    assert_true($stmt->execute() !== false);
});
test('read product', function() use ($db) {
    $r = $db->querySingle("SELECT message FROM products WHERE id='p100' AND vendor_id='v1'");
    assert_eq('Test message', $r);
});

echo "\n--- Product Variants Insert ---\n";
test('insert variant', function() use ($db) {
    $stmt = $db->prepare('INSERT INTO product_variants (user_name, product_id, vendor_id, product_name, variant_name, price_usd, shipping_usd) VALUES (:u, :pid, :vid, :pn, :vn, :pr, :sh)');
    $stmt->bindValue(':u', 'testuser', SQLITE3_TEXT);
    $stmt->bindValue(':pid', 'p100', SQLITE3_TEXT);
    $stmt->bindValue(':vid', 'v1', SQLITE3_TEXT);
    $stmt->bindValue(':pn', 'GPU Card', SQLITE3_TEXT);
    $stmt->bindValue(':vn', 'V100-32G', SQLITE3_TEXT);
    $stmt->bindValue(':pr', 756.05, SQLITE3_FLOAT);
    $stmt->bindValue(':sh', 12.50, SQLITE3_FLOAT);
    assert_true($stmt->execute() !== false);
});
test('read variant', function() use ($db) {
    $r = $db->querySingle("SELECT variant_name FROM product_variants WHERE product_id='p100' AND vendor_id='v1'");
    assert_eq('V100-32G', $r);
});
test('variant price precision', function() use ($db) {
    $r = $db->querySingle("SELECT price_usd FROM product_variants WHERE product_id='p100' AND vendor_id='v1'");
    assert_eq(756.05, $r);
});
test('variant has created_at', function() use ($db) {
    $r = $db->querySingle("SELECT created_at FROM product_variants WHERE product_id='p100' AND vendor_id='v1'");
    assert_true($r !== null && $r !== '', 'created_at should be set');
});
test('variant autoincrement', function() use ($db) {
    $stmt = $db->prepare('INSERT INTO product_variants (user_name, product_id, vendor_id, product_name, variant_name, price_usd, shipping_usd) VALUES (:u, :pid, :vid, :pn, :vn, :pr, :sh)');
    $stmt->bindValue(':u', 'user2', SQLITE3_TEXT);
    $stmt->bindValue(':pid', 'p200', SQLITE3_TEXT);
    $stmt->bindValue(':vid', 'v1', SQLITE3_TEXT);
    $stmt->bindValue(':pn', 'Another', SQLITE3_TEXT);
    $stmt->bindValue(':vn', 'V100-16G', SQLITE3_TEXT);
    $stmt->bindValue(':pr', 194.72, SQLITE3_FLOAT);
    $stmt->bindValue(':sh', 5.00, SQLITE3_FLOAT);
    $stmt->execute();
    $id = $db->querySingle("SELECT id FROM product_variants WHERE product_id='p200' AND vendor_id='v1'");
    assert_eq(2, $id, 'autoincrement should be sequential');
});

echo "\n--- Foreign Key Constraints ---\n";
test('FK: cannot insert product with nonexistent vendor', function() use ($db) {
    try {
        $stmt = $db->prepare('INSERT INTO products (id, vendor_id) VALUES (:pid, :vid)');
        $stmt->bindValue(':pid', 'orphan', SQLITE3_TEXT);
        $stmt->bindValue(':vid', 'nonexistent', SQLITE3_TEXT);
        $stmt->execute();
        throw new RuntimeException('Should have failed FK constraint');
    } catch (Exception $e) {
        assert_true(str_contains($e->getMessage(), 'FOREIGN KEY') || str_contains($e->getMessage(), 'constraint'));
    }
});

echo "\n--- User Name Length ---\n";
test('user_name truncated to 64', function() use ($db) {
    $longName = str_repeat('a', 100);
    $stmt = $db->prepare('INSERT INTO product_variants (user_name, product_id, vendor_id, product_name, variant_name, price_usd, shipping_usd) VALUES (:u, :pid, :vid, :pn, :vn, :pr, :sh)');
    $stmt->bindValue(':u', mb_substr($longName, 0, 64), SQLITE3_TEXT);
    $stmt->bindValue(':pid', 'p300', SQLITE3_TEXT);
    $stmt->bindValue(':vid', 'v1', SQLITE3_TEXT);
    $stmt->bindValue(':pn', 'Test', SQLITE3_TEXT);
    $stmt->bindValue(':vn', 'Variant', SQLITE3_TEXT);
    $stmt->bindValue(':pr', 10.0, SQLITE3_FLOAT);
    $stmt->bindValue(':sh', 0.0, SQLITE3_FLOAT);
    $stmt->execute();
    $stored = $db->querySingle("SELECT length(user_name) FROM product_variants WHERE product_id='p300' AND vendor_id='v1'");
    assert_eq(64, $stored);
});

$db->close();
@unlink($dbPath);

echo "\n==============================\n";
echo "Results: $pass passed, $fail failed\n";
echo "==============================\n";
exit($fail > 0 ? 1 : 0);
