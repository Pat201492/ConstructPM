import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { HeaderBell } from '../components/UI';

// Shared
import NotificationsScreen from '../screens/shared/NotificationsScreen';
import ProfileScreen from '../screens/shared/ProfileScreen';

// Admin
import AdminRequestsScreen from '../screens/admin/RequestsScreen';

// PM
import PMRequestsScreen from '../screens/pm/RequestsScreen';
import QuickBidScreen from '../screens/pm/QuickBidScreen';

// Shop Staff
import OpenRequestsScreen from '../screens/shop/OpenRequestsScreen';
import ReturnScreen from '../screens/shop/ReturnScreen';
import MaintenanceScreen from '../screens/shop/MaintenanceScreen';

// Foreman
import FieldNotesScreen from '../screens/foreman/FieldNotesScreen';
import OilSamplesScreen from '../screens/foreman/OilSamplesScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const screenOptions = {
  headerStyle: { backgroundColor: colors.bg2 },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '600' },
};

const tabScreenOptions = ({ route }) => ({
  ...screenOptions,
  tabBarStyle: { backgroundColor: colors.bg2, borderTopColor: colors.border },
  tabBarActiveTintColor: colors.primary,
  tabBarInactiveTintColor: colors.text3,
  tabBarIcon: ({ color, size }) => {
    const icons = {
      'Requests': 'construct-outline',
      'Equipment': 'construct-outline',
      'Quick Bid': 'document-text-outline',
      'Open': 'list-outline',
      'Return': 'arrow-undo-outline',
      'Maintenance': 'build-outline',
      'Field Notes': 'create-outline',
      'Oil Samples': 'flask-outline',
      'Notifications': 'notifications-outline',
      'Profile': 'person-outline',
    };
    return <Ionicons name={icons[route.name] || 'ellipse-outline'} size={size} color={color} />;
  },
});

// ── ADMIN NAVIGATOR ─────────────────────────────────────────
function AdminTabs() {
  return (
    <Tab.Navigator screenOptions={tabScreenOptions}>
      <Tab.Screen name="Requests" component={AdminRequestsScreen} options={({ navigation }) => ({
        headerRight: () => <HeaderBell navigation={navigation} />,
      })} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

// ── PM NAVIGATOR ────────────────────────────────────────────
function PMTabs() {
  return (
    <Tab.Navigator screenOptions={tabScreenOptions}>
      <Tab.Screen name="Equipment" component={PMRequestsScreen} options={({ navigation }) => ({
        title: 'Equipment Requests',
        headerRight: () => <HeaderBell navigation={navigation} />,
      })} />
      <Tab.Screen name="Quick Bid" component={QuickBidScreen} options={({ navigation }) => ({
        headerRight: () => <HeaderBell navigation={navigation} />,
      })} />
      <Tab.Screen name="Notifications" component={NotificationsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

// ── SHOP STAFF NAVIGATOR ────────────────────────────────────
function ShopTabs() {
  return (
    <Tab.Navigator screenOptions={tabScreenOptions}>
      <Tab.Screen name="Open" component={OpenRequestsScreen} options={({ navigation }) => ({
        title: 'Open Requests',
        headerRight: () => <HeaderBell navigation={navigation} />,
      })} />
      <Tab.Screen name="Return" component={ReturnScreen} options={({ navigation }) => ({
        headerRight: () => <HeaderBell navigation={navigation} />,
      })} />
      <Tab.Screen name="Maintenance" component={MaintenanceScreen} options={({ navigation }) => ({
        headerRight: () => <HeaderBell navigation={navigation} />,
      })} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

// ── FOREMAN NAVIGATOR ───────────────────────────────────────
function ForemanTabs() {
  return (
    <Tab.Navigator screenOptions={tabScreenOptions}>
      <Tab.Screen name="Field Notes" component={FieldNotesScreen} options={({ navigation }) => ({
        headerRight: () => <HeaderBell navigation={navigation} />,
      })} />
      <Tab.Screen name="Oil Samples" component={OilSamplesScreen} options={({ navigation }) => ({
        headerRight: () => <HeaderBell navigation={navigation} />,
      })} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

// ── MAIN NAVIGATOR (wraps role tabs in a stack for modals) ──
export function getNavigatorForRole(role) {
  const RoleTabs = {
    admin: AdminTabs,
    project_manager: PMTabs,
    shop_staff: ShopTabs,
    foreman: ForemanTabs,
  }[role] || PMTabs; // Default to PM if unknown

  return function RoleNavigator() {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Main" component={RoleTabs} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ ...screenOptions, headerShown: true, presentation: 'modal' }} />
      </Stack.Navigator>
    );
  };
}
