/**
 * __demo.tsx — Dev-only sandbox for Combat Feedback Primitives.
 *
 * NOT registered in any route. To use during development:
 *   1. Temporarily swap a screen's content with <FeedbackDemo />
 *   2. Or import directly in App.tsx below the router for a quick visual check.
 *
 * Exercises each primitive against the spec's Verification checklist:
 *   1. FlashOverlay: green and red, rapid trigger, no residue
 *   2. Wiggle: returns to rest, rapid trigger no drift
 *   3. LaggingHpBar: damage lag, heal snap
 *   4. ResultsPopup: open/close, backdrop dismiss, auto-dismiss
 *   5. DamagePop: regression in isolation
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DamagePop from './DamagePop';
import FlashOverlay from './FlashOverlay';
import LaggingHpBar from './LaggingHpBar';
import ResultsPopup from './ResultsPopup';
import { COLOR_DAMAGE, COLOR_HIT } from './tokens';
import Wiggle from './Wiggle';

export default function FeedbackDemo() {
  // FlashOverlay
  const [flashGreenTrigger, setFlashGreenTrigger] = useState(0);
  const [flashRedTrigger, setFlashRedTrigger] = useState(0);
  const [flashBorderTrigger, setFlashBorderTrigger] = useState(0);

  // Wiggle
  const [wiggleXTrigger, setWiggleXTrigger] = useState(0);
  const [wiggleRotateTrigger, setWiggleRotateTrigger] = useState(0);

  // LaggingHpBar
  const [hp, setHp] = useState(100);
  const maxHp = 100;

  // ResultsPopup
  const [popupVisible, setPopupVisible] = useState(false);

  // DamagePop
  const [damagePopHp, setDamagePopHp] = useState(100);

  const fireRapid = (setter: React.Dispatch<React.SetStateAction<number>>) => {
    setter(n => n + 1);
    setTimeout(() => setter(n => n + 1), 60);
    setTimeout(() => setter(n => n + 1), 120);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.header}>Combat Feedback Primitives — Dev Demo</Text>

      {/* ------------------------------------------------------------------ */}
      {/* FlashOverlay                                                         */}
      {/* ------------------------------------------------------------------ */}
      <Text style={styles.section}>FlashOverlay</Text>

      <View style={styles.row}>
        <View style={[styles.box, { position: 'relative' }]}>
          <Text style={styles.boxLabel}>Green hit</Text>
          <FlashOverlay trigger={flashGreenTrigger} color={COLOR_HIT} />
        </View>
        <TouchableOpacity style={styles.btn} onPress={() => setFlashGreenTrigger(n => n + 1)}>
          <Text style={styles.btnText}>Fire</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => fireRapid(setFlashGreenTrigger)}>
          <Text style={styles.btnText}>Rapid x3</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.row}>
        <View style={[styles.box, { position: 'relative' }]}>
          <Text style={styles.boxLabel}>Red damage</Text>
          <FlashOverlay trigger={flashRedTrigger} color={COLOR_DAMAGE} />
        </View>
        <TouchableOpacity style={styles.btn} onPress={() => setFlashRedTrigger(n => n + 1)}>
          <Text style={styles.btnText}>Fire</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.row}>
        <View style={[styles.box, { position: 'relative' }]}>
          <Text style={styles.boxLabel}>Border mode</Text>
          <FlashOverlay trigger={flashBorderTrigger} color={COLOR_HIT} fillMode="border" intensity={0.9} />
        </View>
        <TouchableOpacity style={styles.btn} onPress={() => setFlashBorderTrigger(n => n + 1)}>
          <Text style={styles.btnText}>Fire</Text>
        </TouchableOpacity>
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* Wiggle                                                               */}
      {/* ------------------------------------------------------------------ */}
      <Text style={styles.section}>Wiggle</Text>

      <View style={styles.row}>
        <Wiggle trigger={wiggleXTrigger} axis="x" amplitude={6}>
          <View style={styles.box}>
            <Text style={styles.boxLabel}>X axis</Text>
          </View>
        </Wiggle>
        <TouchableOpacity style={styles.btn} onPress={() => setWiggleXTrigger(n => n + 1)}>
          <Text style={styles.btnText}>Wiggle</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => fireRapid(setWiggleXTrigger)}>
          <Text style={styles.btnText}>Rapid x3</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.row}>
        <Wiggle trigger={wiggleRotateTrigger} axis="rotate" amplitude={8}>
          <View style={styles.box}>
            <Text style={styles.boxLabel}>Rotate</Text>
          </View>
        </Wiggle>
        <TouchableOpacity style={styles.btn} onPress={() => setWiggleRotateTrigger(n => n + 1)}>
          <Text style={styles.btnText}>Wiggle</Text>
        </TouchableOpacity>
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* LaggingHpBar                                                         */}
      {/* ------------------------------------------------------------------ */}
      <Text style={styles.section}>LaggingHpBar  (current: {hp}/{maxHp})</Text>

      <View style={{ marginBottom: 12 }}>
        <LaggingHpBar currentHp={hp} maxHp={maxHp} height={12} />
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={() => setHp(h => Math.max(0, h - 20))}>
          <Text style={styles.btnText}>-20 HP</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => setHp(h => Math.max(0, h - 5))}>
          <Text style={styles.btnText}>-5 HP</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => setHp(h => Math.min(maxHp, h + 20))}>
          <Text style={styles.btnText}>+20 Heal</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => setHp(maxHp)}>
          <Text style={styles.btnText}>Full</Text>
        </TouchableOpacity>
      </View>

      {/* ------------------------------------------------------------------ */}
      {/* ResultsPopup                                                         */}
      {/* ------------------------------------------------------------------ */}
      <Text style={styles.section}>ResultsPopup</Text>

      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={() => setPopupVisible(true)}>
          <Text style={styles.btnText}>Open (auto 4s)</Text>
        </TouchableOpacity>
      </View>

      <ResultsPopup
        visible={popupVisible}
        onDismiss={() => setPopupVisible(false)}
      >
        <Text style={styles.popupTitle}>Wave Complete!</Text>
        <Text style={styles.popupBody}>Tap backdrop or wait 4s to dismiss.</Text>
      </ResultsPopup>

      {/* ------------------------------------------------------------------ */}
      {/* DamagePop                                                            */}
      {/* ------------------------------------------------------------------ */}
      <Text style={styles.section}>DamagePop  (HP: {damagePopHp})</Text>

      <View style={styles.row}>
        <View style={styles.damagePopTarget}>
          <DamagePop value={damagePopHp} />
          <Text style={{ color: '#94a3b8', fontSize: 12 }}>{damagePopHp}</Text>
        </View>
        <TouchableOpacity style={styles.btn} onPress={() => setDamagePopHp(h => Math.max(0, h - 15))}>
          <Text style={styles.btnText}>-15 dmg</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => setDamagePopHp(h => Math.min(100, h + 10))}>
          <Text style={styles.btnText}>+10 heal</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  content: {
    padding: 20,
    paddingBottom: 80,
  },
  header: {
    color: '#f1f5f9',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 24,
  },
  section: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  box: {
    width: 100,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxLabel: {
    color: '#94a3b8',
    fontSize: 11,
  },
  btn: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  btnText: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '500',
  },
  popupTitle: {
    color: '#f1f5f9',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  popupBody: {
    color: '#94a3b8',
    fontSize: 14,
  },
  damagePopTarget: {
    width: 80,
    height: 48,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
