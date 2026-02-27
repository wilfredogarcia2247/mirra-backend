# Instrucciones para implementación en Frontend: "Producción Flexible"

## Contexto
Se ha actualizado el endpoint del backend para permitir "Producción Flexible". Esto significa que al completar una orden de producción, el usuario puede especificar la cantidad exacta de ingredientes consumidos, en lugar de obligar al sistema a usar la cálculo de la fórmula matemática estricta.

## 1. Obtención de Datos Iniciales
Utiliza el endpoint existente para obtener los detalles de la orden y sus componentes teóricos (calculados por fórmula).

**Endpoint:** `GET /api/ordenes-produccion/detailed` (o el que estés usando para listar órdenes)
**Datos a usar:** El campo `componentes` que devuelve este endpoint ya incluye:
- `materia_prima_id`: ID del ingrediente.
- `materia_nombre`: Nombre del ingrediente.
- `cantidad_total`: La cantidad calculada teóricamente (Cantidad por unidad * Cantidad a producir).

## 2. Interfaz de Usuario (UI)
En el modal o pantalla de "Completar Producción":
- Mostrar una lista de los ingredientes basándose en el array `componentes` recibido.
- Permitir que el campo **"Cantidad Consumida"** (`cantidad_total`) sea editable por el usuario.
- (Opcional) Permitir agregar filas adicionales si se usaron ingredientes extra no contemplados en la fórmula.

## 3. Envío de Datos al Backend
Al confirmar la acción (botón "Completar"), construye el payload incluyendo el nuevo array `componentes_utilizados`.

**Nuevo Payload para** `POST /api/ordenes-produccion/:id/completar`**:

```json
{
  "almacen_venta_id": 123, // ID del almacén destino (existente)
  "componentes_utilizados": [
    {
      "materia_prima_id": 101, // ID del ingrediente
      "cantidad_total": 105    // Cantidad REAL consumida (editada por el usuario)
    },
    {
      "materia_prima_id": 102,
      "cantidad_total": 50     // Cantidad, puede ser igual a la teórica o diferente
    }
  ]
}
```

## Lógica del Backend Implementada
- **Si envías `componentes_utilizados`:** El sistema ignorará la fórmula e intentará descontar del inventario exactamente lo que envíes en esta lista.
- **Si NO envías `componentes_utilizados` (o envías null/vacío):** El sistema funcionará como antes, calculando los consumos basándose estrictamente en la fórmula definida.

## Notas para el Desarrollador Frontend
- Asegúrate de validar que `cantidad_total` no sea negativa.
- Si el usuario pone `0`, el sistema no descontará nada de ese ingrediente.
- El `materia_prima_id` es obligatorio para cada ítem de la lista.
