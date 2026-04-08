-- ============================================================================
-- Terminal X — Server-Side Price Validation RPCs
-- Issue #21: Prevent client-side price manipulation in web POS
--
-- RPC 1: validate_ticket_prices — validates items against real DB prices
-- RPC 2: create_ticket_validated — atomic ticket creation with price checks
--
-- Deploy via Supabase Management API or SQL Editor
-- ============================================================================

-- ── RPC 1: validate_ticket_prices ───────────────────────────────────────────
-- Validates that submitted item prices match the actual prices in the database.
-- Returns { valid: true/false, errors: [...] }
-- Tolerance: 0.01 (one centavo) to handle float rounding.

CREATE OR REPLACE FUNCTION validate_ticket_prices(
  p_business_id UUID,
  p_items JSONB  -- array of { service_id, inventory_item_id, name, price, quantity }
) RETURNS JSONB AS $$
DECLARE
  item JSONB;
  svc RECORD;
  inv RECORD;
  errors JSONB := '[]'::JSONB;
BEGIN
  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    IF (item->>'service_id') IS NOT NULL THEN
      SELECT s.price INTO svc FROM services s
        WHERE s.id = (item->>'service_id')::UUID AND s.business_id = p_business_id;
      IF svc IS NULL THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'error', 'Service not found: ' || COALESCE(item->>'name', 'unknown'),
          'service_id', item->>'service_id'
        ));
      ELSIF abs(svc.price - (item->>'price')::NUMERIC) > 0.01 THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'error', 'Price mismatch for ' || COALESCE(item->>'name', 'unknown'),
          'expected', svc.price,
          'received', (item->>'price')::NUMERIC,
          'service_id', item->>'service_id'
        ));
      END IF;
    ELSIF (item->>'inventory_item_id') IS NOT NULL THEN
      SELECT i.price INTO inv FROM inventory_items i
        WHERE i.id = (item->>'inventory_item_id')::UUID AND i.business_id = p_business_id;
      IF inv IS NULL THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'error', 'Product not found: ' || COALESCE(item->>'name', 'unknown'),
          'inventory_item_id', item->>'inventory_item_id'
        ));
      ELSIF abs(inv.price - (item->>'price')::NUMERIC) > 0.01 THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'error', 'Price mismatch for ' || COALESCE(item->>'name', 'unknown'),
          'expected', inv.price,
          'received', (item->>'price')::NUMERIC,
          'inventory_item_id', item->>'inventory_item_id'
        ));
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('valid', jsonb_array_length(errors) = 0, 'errors', errors);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ── RPC 2: create_ticket_validated ──────────────────────────────────────────
-- Atomic ticket creation with server-side price validation.
-- Validates prices, generates doc_number, inserts ticket + items + commissions,
-- deducts inventory, adds to queue, updates client balance for credit sales.
--
-- Returns the full ticket record on success, or raises an exception on
-- price mismatch so the transaction is rolled back.

CREATE OR REPLACE FUNCTION create_ticket_validated(
  p_business_id UUID,
  p_items JSONB,           -- array of { service_id, inventory_item_id, name, price, quantity, sku, is_wash }
  p_client_id UUID DEFAULT NULL,
  p_washer_ids JSONB DEFAULT '[]'::JSONB,
  p_seller_id UUID DEFAULT NULL,
  p_cajero_id UUID DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'cash',
  p_comprobante_type TEXT DEFAULT 'B02',
  p_tipo_venta TEXT DEFAULT 'contado',
  p_vehicle_plate TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_descuento NUMERIC DEFAULT 0,
  p_ecf_result JSONB DEFAULT '{}'::JSONB,
  p_beverage_subtotal NUMERIC DEFAULT 0
) RETURNS JSONB AS $$
DECLARE
  item JSONB;
  svc_row RECORD;
  inv_row RECORD;
  validation JSONB;
  v_subtotal NUMERIC := 0;
  v_itbis NUMERIC := 0;
  v_total NUMERIC := 0;
  v_doc_number TEXT;
  v_next_num INT;
  v_last_doc TEXT;
  v_status TEXT;
  v_ticket_id UUID;
  v_ticket RECORD;
  v_aplica_itbis INT;
  v_item_cost NUMERIC;
  v_item_itbis NUMERIC;
  v_comm_base NUMERIC;
  v_bev_base NUMERIC;
  v_washer_id UUID;
  v_washer RECORD;
  v_seller RECORD;
  v_cajero RECORD;
  v_pct NUMERIC;
  v_amt NUMERIC;
BEGIN
  -- ── Step 1: Validate all item prices ──────────────────────────────────────
  validation := validate_ticket_prices(p_business_id, p_items);
  IF NOT (validation->>'valid')::BOOLEAN THEN
    RAISE EXCEPTION 'PRICE_VALIDATION_FAILED: %', validation->>'errors';
  END IF;

  -- ── Step 2: Compute totals from server-side prices ────────────────────────
  -- Use the REAL prices from the database, not the client-submitted ones.
  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    DECLARE
      v_real_price NUMERIC;
      v_qty INT := COALESCE((item->>'quantity')::INT, 1);
      v_item_aplica INT := 1;
    BEGIN
      IF (item->>'service_id') IS NOT NULL THEN
        SELECT s.price, COALESCE(s.aplica_itbis, 1) INTO v_real_price, v_item_aplica
          FROM services s WHERE s.id = (item->>'service_id')::UUID AND s.business_id = p_business_id;
      ELSIF (item->>'inventory_item_id') IS NOT NULL THEN
        SELECT i.price, COALESCE(i.aplica_itbis, 1) INTO v_real_price, v_item_aplica
          FROM inventory_items i WHERE i.id = (item->>'inventory_item_id')::UUID AND i.business_id = p_business_id;
      ELSE
        -- Items without service_id or inventory_item_id (custom/manual) — use submitted price
        v_real_price := (item->>'price')::NUMERIC;
      END IF;

      v_subtotal := v_subtotal + (v_real_price * v_qty);
      IF v_item_aplica != 0 THEN
        v_itbis := v_itbis + ROUND(v_real_price * v_qty * 0.18, 2);
      END IF;
    END;
  END LOOP;

  v_total := v_subtotal + v_itbis - COALESCE(p_descuento, 0);

  -- ── Step 3: Generate doc_number atomically ────────────────────────────────
  SELECT t.doc_number INTO v_last_doc FROM tickets t
    WHERE t.business_id = p_business_id
    ORDER BY t.created_at DESC LIMIT 1;

  v_next_num := 1;
  IF v_last_doc IS NOT NULL THEN
    v_next_num := COALESCE(
      (regexp_match(v_last_doc, 'T-(\d+)'))[1]::INT + 1,
      1
    );
  END IF;
  v_doc_number := 'T-' || lpad(v_next_num::TEXT, 4, '0');

  -- ── Step 4: Determine status ──────────────────────────────────────────────
  IF p_tipo_venta = 'credito' OR p_payment_method = 'credit' THEN
    v_status := 'pendiente';
  ELSE
    v_status := 'cobrado';
  END IF;

  -- ── Step 5: Insert ticket ─────────────────────────────────────────────────
  INSERT INTO tickets (
    business_id, doc_number, client_id, washer_ids, seller_id, cajero_id,
    subtotal, descuento, itbis, ley, total,
    payment_method, comprobante_type, ecf_result, tipo_venta, status,
    vehicle_plate, notes
  ) VALUES (
    p_business_id, v_doc_number, p_client_id, p_washer_ids, p_seller_id, p_cajero_id,
    v_subtotal, COALESCE(p_descuento, 0), v_itbis, 0, v_total,
    p_payment_method, p_comprobante_type, p_ecf_result, p_tipo_venta, v_status,
    p_vehicle_plate, p_notes
  ) RETURNING id INTO v_ticket_id;

  -- ── Step 6: Insert ticket_items with real prices + deduct inventory ───────
  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    DECLARE
      v_real_price NUMERIC;
      v_qty INT := COALESCE((item->>'quantity')::INT, 1);
      v_item_aplica INT := 1;
      v_cost NUMERIC := 0;
      v_svc_id UUID := NULL;
      v_inv_id UUID := NULL;
    BEGIN
      IF (item->>'service_id') IS NOT NULL THEN
        v_svc_id := (item->>'service_id')::UUID;
        SELECT s.price, COALESCE(s.cost, 0), COALESCE(s.aplica_itbis, 1)
          INTO v_real_price, v_cost, v_item_aplica
          FROM services s WHERE s.id = v_svc_id AND s.business_id = p_business_id;
      ELSIF (item->>'inventory_item_id') IS NOT NULL THEN
        v_inv_id := (item->>'inventory_item_id')::UUID;
        SELECT i.price, COALESCE(i.cost, 0), COALESCE(i.aplica_itbis, 1)
          INTO v_real_price, v_cost, v_item_aplica
          FROM inventory_items i WHERE i.id = v_inv_id AND i.business_id = p_business_id;
      ELSE
        v_real_price := (item->>'price')::NUMERIC;
        v_cost := COALESCE((item->>'cost')::NUMERIC, 0);
      END IF;

      v_item_itbis := CASE WHEN v_item_aplica != 0
        THEN ROUND(v_real_price * v_qty * 0.18, 2) ELSE 0 END;

      INSERT INTO ticket_items (
        business_id, ticket_id, service_id, inventory_item_id,
        name, price, cost, itbis, is_wash, quantity, sku
      ) VALUES (
        p_business_id, v_ticket_id, v_svc_id, v_inv_id,
        COALESCE(item->>'name', 'Item'), v_real_price, v_cost, v_item_itbis,
        COALESCE((item->>'is_wash')::BOOLEAN, true), v_qty,
        item->>'sku'
      );

      -- Deduct inventory stock
      IF v_inv_id IS NOT NULL THEN
        UPDATE inventory_items
          SET stock = GREATEST(stock - v_qty, 0),
              updated_at = NOW()
          WHERE id = v_inv_id AND business_id = p_business_id;
      END IF;
    END;
  END LOOP;

  -- ── Step 7: Commissions ───────────────────────────────────────────────────
  -- Commission base: subtotal minus beverages, divided by 1.18 to strip ITBIS
  v_comm_base := ROUND((v_subtotal - COALESCE(p_beverage_subtotal, 0)) / 1.18, 2);
  v_bev_base := CASE WHEN p_beverage_subtotal > 0
    THEN ROUND(p_beverage_subtotal / 1.18, 2) ELSE 0 END;

  -- Washer commissions (on wash/service items only)
  IF v_comm_base > 0 AND jsonb_array_length(p_washer_ids) > 0 THEN
    FOR v_washer_id IN SELECT (value)::UUID FROM jsonb_array_elements_text(p_washer_ids)
    LOOP
      SELECT w.id, w.commission_pct INTO v_washer
        FROM washers w WHERE w.id = v_washer_id AND w.business_id = p_business_id;
      IF v_washer.id IS NOT NULL AND COALESCE(v_washer.commission_pct, 0) > 0 THEN
        v_amt := ROUND(v_comm_base * v_washer.commission_pct / 100, 2);
        INSERT INTO washer_commissions (
          business_id, washer_id, ticket_id, base_amount, commission_pct, commission_amount, paid
        ) VALUES (
          p_business_id, v_washer.id, v_ticket_id, v_comm_base, v_washer.commission_pct, v_amt, false
        );
      END IF;
    END LOOP;
  END IF;

  -- Seller commission (on wash/service items only)
  IF v_comm_base > 0 AND p_seller_id IS NOT NULL THEN
    SELECT s.id, s.commission_pct INTO v_seller
      FROM sellers s WHERE s.id = p_seller_id AND s.business_id = p_business_id;
    IF v_seller.id IS NOT NULL AND COALESCE(v_seller.commission_pct, 0) > 0 THEN
      v_amt := ROUND(v_comm_base * v_seller.commission_pct / 100, 2);
      INSERT INTO seller_commissions (
        business_id, seller_id, ticket_id, base_amount, commission_pct, commission_amount, paid
      ) VALUES (
        p_business_id, v_seller.id, v_ticket_id, v_comm_base, v_seller.commission_pct, v_amt, false
      );
    END IF;
  END IF;

  -- Cajero commission (on beverages/snacks only)
  IF v_bev_base > 0 AND p_cajero_id IS NOT NULL THEN
    SELECT u.id, u.commission_pct INTO v_cajero
      FROM users u WHERE u.id = p_cajero_id AND u.business_id = p_business_id;
    IF v_cajero.id IS NOT NULL AND COALESCE(v_cajero.commission_pct, 0) > 0 THEN
      v_amt := ROUND(v_bev_base * v_cajero.commission_pct / 100, 2);
      INSERT INTO cajero_commissions (
        business_id, cajero_id, ticket_id, base_amount, commission_pct, commission_amount, paid
      ) VALUES (
        p_business_id, v_cajero.id, v_ticket_id, v_bev_base, v_cajero.commission_pct, v_amt, false
      );
    END IF;
  END IF;

  -- ── Step 8: Add to queue ──────────────────────────────────────────────────
  INSERT INTO queue (business_id, ticket_id, status, washer_id)
  VALUES (
    p_business_id, v_ticket_id, 'waiting',
    CASE WHEN jsonb_array_length(p_washer_ids) > 0
      THEN (p_washer_ids->>0)::UUID ELSE NULL END
  );

  -- ── Step 9: Update client balance for credit sales ────────────────────────
  IF v_status = 'pendiente' AND p_client_id IS NOT NULL THEN
    UPDATE clients SET balance = COALESCE(balance, 0) + v_total
      WHERE id = p_client_id AND business_id = p_business_id;
  END IF;

  -- ── Return ────────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'id', v_ticket_id,
    'doc_number', v_doc_number,
    'total', v_total,
    'subtotal', v_subtotal,
    'itbis', v_itbis,
    'status', v_status
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
