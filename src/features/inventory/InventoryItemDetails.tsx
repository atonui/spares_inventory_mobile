import {ScrollView, StyleSheet, Text, View} from 'react-native';
import type {InventoryRow, NativeUser} from '../../api/client';
import {canAdjustStock} from '../auth/roleCapabilities';
import {StockAdjustmentControls} from './StockAdjustmentControls';

const palette = {
  navy: '#15263B',
  muted: '#64748B',
  border: '#CBD5E1',
  white: '#FFFFFF',
  text: '#15263B',
};

export function InventoryItemDetails({item, user, userId, onQuantityChange, onRefresh}: {
  item: InventoryRow;
  user: NativeUser | null;
  userId: number;
  onQuantityChange: (quantity: number) => void;
  onRefresh: () => Promise<number>;
}) {
  const outOfStock = item.quantity === 0;
  const lowStock = !outOfStock && item.quantity <= item.minThreshold;
  const canChangeStock = user?.id === userId && canAdjustStock(user, item);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text accessibilityRole="header" style={styles.partNumber}>{item.partNumber}</Text>
        <Text style={styles.description}>{item.description}</Text>
        <View style={[styles.stockBadge, lowStock && styles.lowStockBadge, outOfStock && styles.outOfStockBadge]}>
          <Text style={[styles.stockValue, lowStock && styles.lowStockText, outOfStock && styles.outOfStockText]}>
            {item.quantity} {item.quantity === 1 ? 'unit' : 'units'}
          </Text>
          <Text style={[styles.stockLabel, lowStock && styles.lowStockText, outOfStock && styles.outOfStockText]}>
            {outOfStock ? 'OUT OF STOCK' : lowStock ? 'LOW STOCK' : 'IN STOCK'}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Stock information</Text>
        <DetailField label="Minimum threshold" value={`${item.minThreshold} ${item.minThreshold === 1 ? 'unit' : 'units'}`} />
        <DetailField label="Availability" value={item.isAllocated ? 'Allocated' : 'Available'} />
        {item.workOrder && <DetailField label="Work order" value={item.workOrder} />}
      </View>

      {!item.isAllocated && canChangeStock && (
        <StockAdjustmentControls item={item} userId={userId} onQuantityChange={onQuantityChange} onRefresh={onRefresh} />
      )}
      {!item.isAllocated && user?.id === userId && !canChangeStock && (
        <View accessibilityRole="text" style={styles.accessNotice}>
          <Text style={styles.accessNoticeText}>Stock adjustments are limited to central and assigned stores.</Text>
        </View>
      )}

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Storage location</Text>
        <DetailField label="Store" value={item.storeName} />
        <DetailField label="Store type" value={storeTypeLabel(item.storeType)} />
      </View>
    </ScrollView>
  );
}

function DetailField({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function storeTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    warehouse: 'Warehouse',
    customer_site: 'Customer site',
    engineer: 'Engineer',
  };
  return labels[value] ?? value.replaceAll('_', ' ');
}

const styles = StyleSheet.create({
  content: {paddingTop: 16, paddingBottom: 28, gap: 12},
  hero: {padding: 18, borderRadius: 16, backgroundColor: palette.navy},
  partNumber: {fontSize: 19, fontWeight: '800', color: palette.white},
  description: {marginTop: 6, fontSize: 15, lineHeight: 22, color: '#E2EAF1'},
  stockBadge: {alignSelf: 'flex-start', alignItems: 'center', marginTop: 18, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 11, backgroundColor: '#DCEFE1'},
  stockValue: {fontSize: 17, fontWeight: '800', color: '#21653A'},
  stockLabel: {marginTop: 2, fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: '#21653A'},
  lowStockBadge: {backgroundColor: '#FCE8D9'},
  lowStockText: {color: '#8A3E18'},
  outOfStockBadge: {backgroundColor: '#FFF0EE'},
  outOfStockText: {color: '#A13A32'},
  card: {padding: 16, borderRadius: 15, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  accessNotice: {padding: 14, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  accessNoticeText: {fontSize: 13, lineHeight: 19, color: palette.muted},
  sectionTitle: {marginBottom: 4, fontSize: 15, fontWeight: '800', color: palette.navy},
  field: {flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EDF1F4'},
  label: {flex: 1, fontSize: 13, color: palette.muted},
  value: {flex: 1, textAlign: 'right', fontSize: 13, fontWeight: '700', color: palette.text},
});
