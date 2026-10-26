# fn_80114420 as game/dol.ts (soundBanks) writes it: the game's picks a bank by type ID, which a new character shares with its base.
#   powerpc-eabi-as -mgekko -mregnames -o sfxbanks.o sfxbanks.s
#   powerpc-eabi-ld -Ttext=0x80114420 -e fn_80114420 --defsym strcmp=0x80172654 --defsym fn_80432844=0x80432844 \
#     --defsym fn_80432870=0x80432870 --defsym fn_80434900=0x80434900 --defsym fn_804317BC=0x804317BC \
#     --defsym fn_8042FF2C=0x8042FF2C --defsym fn_8009ABEC=0x8009ABEC --defsym fn_8045777C=0x8045777C -o sfxbanks.elf sfxbanks.o
#   powerpc-eabi-objcopy -O binary -j .text sfxbanks.elf sfxbanks.bin
# `table`: 19 words (type ID -> bank name, 0 for none), then {entity name, alt entity name, bank name} strings, ended by "".
# Only the first player of a type ID gets a bank, since a new character's bank keeps its base's AEMS module IDs.
	.text
	.globl fn_80114420
fn_80114420:
	stwu r1, -0x40(r1)
	mflr r0
	stmw r25, 0x24(r1)
	stw r0, 0x44(r1)
	lwz r0, -0x7ea4(r13)        # lbl_8066B63C
	cmpwi r0, 0
	beq done
	lwz r0, -0x77d0(r13)        # lbl_8066BD10
	cmpwi r0, 0
	bne done
	lis r3, 0x8055
	addi r3, r3, 0x26ac         # level name
	lis r4, 0x8049
	addi r4, r4, 0x771c         # "0_Test_Arena"
	bl strcmp
	mr r31, r3
	lis r3, 0x8055
	addi r3, r3, 0x2110         # G
	bl fn_80432844
	cmpwi r3, 0
	bne go
	lis r3, 0x8055
	addi r3, r3, 0x2110
	bl fn_80432870
	cmpwi r3, 0
	bne go
	cmpwi r31, 0
	bne done
go:
	li r30, 0                   # player
	li r29, 0                   # type IDs loaded, as bits
loop:
	lis r3, 0x8055
	addi r3, r3, 0x2110
	bl fn_80434900
	cmpw r30, r3
	bge done
	lis r3, 0x8055
	addi r3, r3, 0x2110
	mr r4, r30
	bl fn_804317BC
	mr r28, r3                  # slot
	bl fn_8042FF2C
	bl fn_8009ABEC
	mr r27, r3                  # type ID
	cmplwi r27, 31
	bgt custom
	li r0, 1
	slw r0, r0, r27
	and. r9, r29, r0
	bne next
	or r29, r29, r0
custom:
	lis r26, table@ha
	addi r26, r26, table@l + 19 * 4
entry:
	lbz r0, 0(r26)
	cmpwi r0, 0
	beq bytype
	addi r3, r28, 4             # the slot's entity name
	mr r4, r26
	bl strcmp
	mr r25, r3
	bl skip
	addi r3, r28, 4
	mr r4, r26
	bl strcmp
	bl skip
	cmpwi r3, 0
	beq found
	cmpwi r25, 0
	beq found
	bl skip
	b entry
found:
	mr r4, r26
	b load
bytype:
	cmplwi r27, 18
	bgt next
	lis r9, table@ha
	addi r9, r9, table@l
	slwi r0, r27, 2
	lwzx r4, r9, r0
	cmpwi r4, 0
	beq next
load:
	lwz r3, -0x7758(r13)        # lbl_8066BD88
	li r5, 1
	bl fn_8045777C
next:
	addi r30, r30, 1
	b loop
done:
	lwz r0, 0x44(r1)
	mtlr r0
	lmw r25, 0x24(r1)
	addi r1, r1, 0x40
	blr
# r26 past the string it points at; keeps r3.
skip:
	lbz r0, 0(r26)
	addi r26, r26, 1
	cmpwi r0, 0
	bne skip
	blr
	.balign 4
table:
