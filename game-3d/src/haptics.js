// Helper fino de vibração de controller (haptics) — encapsula
// gamepad.hapticActuators[0].pulse(...) num único lugar, pra não duplicar
// essa chamada em cada módulo que quiser dar feedback tátil.
//
// Recebe o CONTROLLER (o THREE.Group retornado por renderer.xr.getController,
// o mesmo objeto usado em toda parte do projeto — grab.js, teleport.js etc.),
// não o XRInputSource cru: o `userData.inputSource` é preenchido no evento
// 'connected' (ver game.js#buildController), padrão oficial do three.js pra
// expor o gamepad de um controller.
export function pulseHaptic(controller, intensity = 0.4, durationMs = 40) {
  const actuator = controller?.userData?.inputSource?.gamepad?.hapticActuators?.[0];
  actuator?.pulse?.(intensity, durationMs);
}
