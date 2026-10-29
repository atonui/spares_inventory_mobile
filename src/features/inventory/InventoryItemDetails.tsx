import {ScrollView, StyleSheet, Text, View} from 'react-native';
import type {InventoryRow, NativeUser} from '../../api/client';
import {canAdjustStock} from '../auth/roleCapabilities';
import {StockAdjustmentControls} from './StockAdjustmentControls';
import {StockOperations} from './StockOperations';
import {AppIcon} from '../navigation/AppIcon';

const palette = {
  navy: '#15263B',
  muted: '#64748B',
  border: '#CBD5E1',
  white: '#FFFFFF',
  text: '#15263B',
  background: '#F5F7FA',
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
        <View style={styles.heroHeading}>
          <View style={styles.itemMark}><AppIcon name="inventory" color={palette.navy} size={22} /></View>
          <View style={styles.heroCopy}>
            <Text accessibilityRole="header" style={styles.partNumber}>{item.partNumber}</Text>
            <Text style={styles.description}>{item.description}</Text>
            <Text style={styles.location}>{item.storeName}</Text>
          </View>
        </View>
        <View style={styles.metricsRow}>
          <View accessibilityLabel={`${item.quantity} ${item.quantity === 1 ? 'unit' : 'units'} on hand`} style={styles.metric}>
            <Text style={styles.stockValue}>{item.quantity}</Text>
            <Text style={styles.stockLabel}>On hand</Text>
          </View>
          <View style={styles.metric}>
            <Text style={[styles.metricValue, lowStock && styles.lowStockText, outOfStock && styles.outOfStockText]}>{item.minThreshold}</Text>
            <Text style={styles.stockLabel}>Reorder at</Text>
          </View>
        </View>
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Stock information</Text>
        <DetailField label="Minimum threshold" value={`${item.minThreshold} ${item.minThreshold === 1 ? 'unit' : 'units'}`} />
        <DetailField label="Availability" value={item.isAllocated ? 'Allocated' : 'Available'} />
        {item.workOrder && <DetailField label="Work order" value={item.workOrder} />}
      </View>

      {!item.isAllocated && canChangeStock && <StockOperations item={item} userId={userId} onRefresh={onRefresh} />}
      {!item.isAllocated && canChangeStock && (
        <StockAdjustmentControls item={item} userId={userId} onQuantityChange={onQuantityChange} onRefresh={onRefresh} showAddStock={false} />
      )}
      {!item.isAllocated && user?.id === userId && !canChangeStock && (
        <View accessibilityRole="text" style={styles.accessNotice}>
          <Text style={styles.accessNoticeText}>Stock adjustments are limited to central and assigned stores.</Text>
        </View>
      )}

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Storage location</Text>
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
  content: {paddingTop: 14, paddingBottom: 24, gap: 12},
  hero: {padding: 16, borderRadius: 18, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  heroHeading: {flexDirection: 'row', alignItems: 'flex-start', gap: 12},
  itemMark: {width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#FFF2D9'},
  heroCopy: {flex: 1},
  partNumber: {fontSize: 17, fontWeight: '800', color: palette.navy},
  description: {marginTop: 3, fontSize: 13, lineHeight: 19, color: palette.muted},
  location: {marginTop: 7, fontSize: 12, fontWeight: '700', color: palette.muted},
  metricsRow: {flexDirection: 'row', alignItems: 'stretch', gap: 8, marginTop: 16},
  metric: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: palette.background},
  metricValue: {fontSize: 17, fontWeight: '800', color: palette.navy},
  stockValue: {fontSize: 19, fontWeight: '800', color: palette.navy},
  stockLabel: {marginTop: 3, fontSize: 11, fontWeight: '600', color: palette.muted},
  lowStockText: {color: '#8A3E18'},
  outOfStockText: {color: '#A13A32'},
  card: {padding: 16, borderRadius: 15, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  accessNotice: {padding: 14, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  accessNoticeText: {fontSize: 13, lineHeight: 19, color: palette.muted},
  sectionTitle: {marginBottom: 4, fontSize: 15, fontWeight: '800', color: palette.navy},
  field: {flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EDF1F4'},
  label: {flex: 1, fontSize: 13, color: palette.muted},
  value: {flex: 1, textAlign: 'right', fontSize: 13, fontWeight: '700', color: palette.text},
});
