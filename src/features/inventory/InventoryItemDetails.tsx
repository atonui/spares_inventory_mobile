import {ScrollView, StyleSheet, Text, View} from 'react-native';
import type {InventoryRow} from '../../api/client';

const palette = {
  navy: '#15263B',
  muted: '#475569',
  border: '#CBD5E1',
  white: '#FFFFFF',
  text: '#15263B',
};

export function InventoryItemDetails({item}: {item: InventoryRow}) {
  const lowStock = item.quantity <= item.minThreshold;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <Text accessibilityRole="header" style={styles.partNumber}>{item.partNumber}</Text>
        <Text style={styles.description}>{item.description}</Text>
        <View style={[styles.stockBadge, lowStock && styles.lowStockBadge]}>
          <Text style={[styles.stockValue, lowStock && styles.lowStockText]}>
            {item.quantity} {item.quantity === 1 ? 'unit' : 'units'}
          </Text>
          <Text style={[styles.stockLabel, lowStock && styles.lowStockText]}>
            {lowStock ? 'LOW STOCK' : 'IN STOCK'}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>Stock information</Text>
        <DetailField label="Minimum threshold" value={`${item.minThreshold} ${item.minThreshold === 1 ? 'unit' : 'units'}`} />
        <DetailField label="Availability" value={item.isAllocated ? 'Allocated' : 'Available'} />
        {item.workOrder && <DetailField label="Work order" value={item.workOrder} />}
      </View>

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
  card: {padding: 16, borderRadius: 15, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white},
  sectionTitle: {marginBottom: 4, fontSize: 15, fontWeight: '800', color: palette.navy},
  field: {flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EDF1F4'},
  label: {flex: 1, fontSize: 13, color: palette.muted},
  value: {flex: 1, textAlign: 'right', fontSize: 13, fontWeight: '700', color: palette.text},
});
