# The air throw (`base_moves.air_throw`), in a text section of its own after the game's, as game/dol.ts (airThrow) adds it.
# Position-independent like gun.s: game functions are called through ctr and `data` is found from the pc.
#   powerpc-eabi-as -mgekko -mregnames -o airthrow.o airthrow.s
#   powerpc-eabi-ld -Ttext=0x80700000 -e at_gate \
#     --defsym Entity_GetActor=0x800CC5E0 --defsym fn_80434900=0x80434900 --defsym fn_804317BC=0x804317BC \
#     --defsym fn_8042FF2C=0x8042FF2C --defsym strcmp=0x80172654 --defsym fn_8044667C=0x8044667C \
#     --defsym fn_800ACFA8=0x800ACFA8 --defsym fn_800C98BC=0x800C98BC --defsym fn_8005A828=0x8005A828 \
#     --defsym fn_8042EC54=0x8042EC54 --defsym fn_801BE3C4=0x801BE3C4 -o airthrow.elf airthrow.o
#   powerpc-eabi-objcopy -O binary -j .text airthrow.elf airthrow.bin
# at_gate also aims an air-throw character's super jump attack (fn_800DDCB4 aims only super attack far), at_event clears the
# aim at event 0x7F, at_elev aims from the club's height to the target's body.
# `data`: {u32 count, count x {char[32] entity name, char[32] alt entity name, f32 drop}}, written by dol.ts.
	.text
	.globl at_gate, at_event, at_elev
	.set ENTRY, 0x44
	.set DROP, 0x40
	.set MOTION, 0x3b           # SuperJumpAttack
	.set CLEAR_EVENT, 0x7f

	.macro call fn
	lis r12, \fn@ha
	addi r12, r12, \fn@l
	mtctr r12
	bctrl
	.endm

# fn_800DDCB4's aim gate, in place of lwz r0, 0x58(r31) (r31 its frame, r16 the controller): r0 = the aim flag.
at_gate:
	stwu r1, -0x30(r1)
	mflr r0
	stw r0, 0x34(r1)
	stmw r27, 0x1c(r1)
	mr r30, r31
	lwz r29, 0x58(r30)
	cmpwi r29, 0
	bne 9f
	mr r3, r16
	call Entity_GetActor
	mr. r28, r3
	beq 9f
	bl listed
	cmpwi r3, 0
	beq 9f
	lwz r0, 0x14(r30)
	cmpwi r0, MOTION
	bne 1f
	mr r3, r28
	bl opponent
	mr. r27, r3
	beq 1f
	li r29, 1
	stw r27, 0x3c(r30)
	mr r3, r16
	mr r4, r27
	li r5, 1
	call fn_800C98BC
	mr r3, r28
	addi r4, r27, 0xa8
	call fn_8005A828
	b 9f
1:	mr r3, r28
	bl clear_aim
9:	lwz r12, 0x34(r1)
	mtlr r12
	mr r0, r29
	lmw r27, 0x1c(r1)
	addi r1, r1, 0x30
	blr

# fn_80058C94 (event dispatcher), in place of its stwu r1, -0x140(r1): event 0x7F clears the aim (r4 the target source).
at_event:
	cmpwi r5, CLEAR_EVENT
	beq 1f
	stwu r1, -0x140(r1)
	lis r12, 0x8005
	ori r12, r12, 0x8c98
	mtctr r12
	bctr
1:	stwu r1, -0x10(r1)
	mflr r0
	stw r0, 0x14(r1)
	lwz r3, 0x214(r4)
	call fn_800ACFA8
	cmpwi r3, 0
	beq 9f
	bl clear_aim
9:	lwz r0, 0x14(r1)
	mtlr r0
	addi r1, r1, 0x10
	blr

# fn_800DDCB4's arcsine of the aim's z, in place of bl fn_801BE3C4.
at_elev:
	lwz r0, 0x14(r31)
	cmpwi r0, MOTION
	bne 8f
	stwu r1, -0x40(r1)
	mflr r0
	stw r0, 0x44(r1)
	stmw r28, 0x30(r1)
	mr r3, r16
	call Entity_GetActor
	mr. r28, r3
	beq 7f
	bl listed
	mr. r29, r3
	beq 7f
	lwz r30, 0x3c(r31)
	cmpwi r30, 0
	beq 7f
	lfs f0, 0xa8(r30)
	lfs f2, 0xa8(r28)
	fsubs f0, f0, f2
	stfs f0, 0x10(r1)
	lfs f0, 0xac(r30)
	lfs f2, 0xac(r28)
	fsubs f0, f0, f2
	stfs f0, 0x14(r1)
	lfs f0, 0xb0(r30)
	lfs f2, 0xb0(r28)
	fsubs f0, f0, f2
	lfs f2, DROP(r29)
	fsubs f0, f0, f2
	stfs f0, 0x18(r1)
	li r0, 0
	stw r0, 0x1c(r1)
	addi r3, r1, 0x10
	call fn_8042EC54             # normalizes in place, returns the length
	li r0, 0
	stw r0, 8(r1)
	lfs f0, 8(r1)
	fcmpu cr0, f1, f0
	ble 7f
	lfs f1, 0x18(r1)
	b 6f
7:	lfs f1, 0x80(r31)
6:	lmw r28, 0x30(r1)
	lwz r0, 0x44(r1)
	mtlr r0
	addi r1, r1, 0x40
8:	lis r12, fn_801BE3C4@ha
	addi r12, r12, fn_801BE3C4@l
	mtctr r12
	bctr

# r3 = actor r3's entry in `data` if it is a listed player, else 0.
listed:
	stwu r1, -0x30(r1)
	mflr r0
	stw r0, 0x34(r1)
	stmw r25, 0x14(r1)
	mr r31, r3
	bl here
	mr r30, r11
	li r29, 0
	li r25, 0
1:	lis r3, 0x8055
	addi r3, r3, 0x2110
	call fn_80434900
	cmpw r29, r3
	bge 9f
	lis r3, 0x8055
	addi r3, r3, 0x2110
	mr r4, r29
	call fn_804317BC
	mr r28, r3
	call fn_8042FF2C
	addi r29, r29, 1
	cmpw r3, r31
	bne 1b
	lwz r27, 0(r30)
	addi r26, r30, 4
2:	cmpwi r27, 0
	ble 9f
	addi r3, r28, 4
	mr r4, r26
	call strcmp
	cmpwi r3, 0
	beq 3f
	addi r3, r28, 4
	addi r4, r26, 0x20
	call strcmp
	cmpwi r3, 0
	beq 3f
	addi r26, r26, ENTRY
	addi r27, r27, -1
	b 2b
3:	mr r25, r26
9:	mr r3, r25
	lmw r25, 0x14(r1)
	lwz r0, 0x34(r1)
	mtlr r0
	addi r1, r1, 0x30
	blr

# r3 = the actor of the player nearest actor r3, or 0.
opponent:
	stwu r1, -0x30(r1)
	mflr r0
	stw r0, 0x34(r1)
	stmw r28, 0x20(r1)
	mr r31, r3
	li r30, 0
	li r29, 0
	lis r0, 0x7f7f
	stw r0, 8(r1)
1:	lis r3, 0x8055
	addi r3, r3, 0x2110
	call fn_80434900
	cmpw r30, r3
	bge 9f
	lis r3, 0x8055
	addi r3, r3, 0x2110
	mr r4, r30
	call fn_804317BC
	call fn_8042FF2C
	addi r30, r30, 1
	mr. r28, r3
	beq 1b
	cmpw r28, r31
	beq 1b
	lfs f1, 0xa8(r28)
	lfs f0, 0xa8(r31)
	fsubs f1, f1, f0
	fmuls f1, f1, f1
	lfs f2, 0xac(r28)
	lfs f0, 0xac(r31)
	fsubs f2, f2, f0
	fmadds f1, f2, f2, f1
	lfs f2, 0xb0(r28)
	lfs f0, 0xb0(r31)
	fsubs f2, f2, f0
	fmadds f1, f2, f2, f1
	lfs f0, 8(r1)
	fcmpo cr0, f1, f0
	bge 1b
	stfs f1, 8(r1)
	mr r29, r28
	b 1b
9:	mr r3, r29
	lmw r28, 0x20(r1)
	lwz r0, 0x34(r1)
	mtlr r0
	addi r1, r1, 0x30
	blr

# Clears actor r3's aim pose as the flight state's enter (fn_800D7CDC) does.
clear_aim:
	stwu r1, -0x10(r1)
	mflr r0
	stw r0, 0x14(r1)
	lwz r3, 0x1bc(r3)
	cmpwi r3, 0
	beq 9f
	lwz r3, 0xb0(r3)
	cmpwi r3, 0
	beq 9f
	addi r3, r3, 0x94
	li r4, 0
	li r5, 0
	stw r5, 8(r1)
	lfs f1, 8(r1)
	fmr f2, f1
	call fn_8044667C
9:	lwz r0, 0x14(r1)
	mtlr r0
	addi r1, r1, 0x10
	blr

# r11 = data, which follows this.
here:
	mflr r0
	bcl 20, 31, 1f
1:	mflr r11
	mtlr r0
	addi r11, r11, 0x10
	blr
